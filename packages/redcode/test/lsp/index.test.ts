import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Deferred, Effect, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { TestInstance, withTestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { spawn } from "@/lsp/launch"
import fs from "fs/promises"

const lspLayer = (flags: Parameters<typeof RuntimeFlags.layer>[0] = {}) =>
  LayerNode.compile(LayerNode.group([LSP.node, Config.node, RuntimeFlags.node, EventV2Bridge.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer(flags)],
  ])

const it = testEffect(Layer.mergeAll(lspLayer(), LayerNode.compile(CrossSpawnSpawner.node)))
const experimentalTyIt = testEffect(
  Layer.mergeAll(lspLayer({ experimentalLspTy: true }), LayerNode.compile(CrossSpawnSpawner.node)),
)
const fakeServerPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
const disabledDownloadIt = testEffect(
  Layer.mergeAll(lspLayer({ disableLspDownload: true }), LayerNode.compile(CrossSpawnSpawner.node)),
)

describe("lsp.spawn", () => {
  it.instance(
    "does not spawn builtin LSP for files outside instance",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
            yield* lsp.hover({
              file: path.join(dir, "..", "hover.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance("does not report unavailable builtin LSPs as errors", () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

        try {
          yield* lsp.hover({
            file: path.join(dir, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
          yield* lsp.hover({
            file: path.join(dir, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
          expect(spy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toEqual([])
        } finally {
          spy.mockRestore()
        }
      }),
    ),
  )

  for (const [name, server, extension] of [
    ["TypeScript", LSPServer.Typescript, ".ts"],
    ["Rust", LSPServer.RustAnalyzer, ".rs"],
    ["Go", LSPServer.Gopls, ".go"],
    ["Python", LSPServer.Pyright, ".py"],
  ] as const) {
    it.instance(`starts at most one ${name} server per root`, () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const root = spyOn(server, "root").mockResolvedValue(dir)
          const spawn = spyOn(server, "spawn").mockResolvedValue(undefined)
          const file = path.join(dir, "src", `inside${extension}`)

          try {
            yield* Effect.all(
              [
                lsp.hover({ file, line: 0, character: 0 }),
                lsp.definition({ file, line: 0, character: 0 }),
                lsp.references({ file, line: 0, character: 0 }),
              ],
              { concurrency: "unbounded" },
            )
            expect(spawn).toHaveBeenCalledTimes(1)
          } finally {
            root.mockRestore()
            spawn.mockRestore()
          }
        }),
      ),
    )
  }

  it.instance("publishes lsp.updated after failed initialization", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const lsp = yield* LSP.Service
      const updated = yield* Deferred.make<void>()
      const events = yield* EventV2Bridge.Service
      const unsubscribe = yield* events.listen((event) => {
        if (event.type === LSP.Event.Updated.type) Deferred.doneUnsafe(updated, Effect.void)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const spy = spyOn(LSPServer.Typescript, "spawn").mockRejectedValue(
        new Error("\u001b[31mmissing\nexecutable\u001b[0m"),
      )

      try {
        yield* lsp.touchFile(path.join(dir, "src", "inside.ts"))
        yield* awaitWithTimeout(Deferred.await(updated), "lsp.updated event was not published")
        expect(yield* lsp.status()).toContainEqual({
          id: "typescript",
          name: "typescript",
          root: "",
          status: "error",
          error: "missing executable",
        })
      } finally {
        spy.mockRestore()
      }
    }),
  )

  it.instance("publishes one update when multiple servers fail for one file", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const lsp = yield* LSP.Service
      const events = yield* EventV2Bridge.Service
      let count = 0
      const unsubscribe = yield* events.listen((event) => {
        if (event.type === LSP.Event.Updated.type) count++
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const servers = [LSPServer.Typescript, LSPServer.ESLint, LSPServer.Oxlint]
      const roots = servers.map((server) => spyOn(server, "root").mockResolvedValue(dir))
      const spawns = servers.map((server) => spyOn(server, "spawn").mockRejectedValue(new Error("failed")))

      try {
        yield* lsp.touchFile(path.join(dir, "inside.ts"))
        expect(count).toBe(1)
      } finally {
        roots.forEach((spy) => spy.mockRestore())
        spawns.forEach((spy) => spy.mockRestore())
      }
    }),
  )

  it.instance("moves a connected server to error when its process exits", () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const handle = {
          process: spawn(process.execPath, [fakeServerPath]),
        }
        const root = spyOn(LSPServer.Typescript, "root").mockResolvedValue(dir)
        const server = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(handle)

        try {
          yield* lsp.touchFile(path.join(dir, "inside.ts"))
          expect(yield* lsp.status()).toContainEqual({
            id: "typescript",
            name: "typescript",
            root: "",
            status: "connected",
          })

          handle.process.kill()
          const status = yield* pollWithTimeout(
            lsp.status().pipe(Effect.map((items) => items.find((item) => item.id === "typescript" && item.status === "error"))),
            "LSP process exit was not reflected in status",
          )
          expect(status.error).toContain("Exited with code")
        } finally {
          root.mockRestore()
          server.mockRestore()
        }
      }),
    ),
  )

  it.instance("keeps Oxlint at the workspace config root instead of package roots", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const nested = path.join(dir, "packages", "app", "src")
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
      yield* Effect.promise(() => Bun.write(path.join(dir, ".oxlintrc.json"), "{}"))
      yield* Effect.promise(() => Bun.write(path.join(dir, "packages", "app", "package.json"), "{}"))

      expect(
        yield* Effect.promise(async () =>
          await withTestInstance({
            directory: dir,
            fn: (ctx) => LSPServer.Oxlint.root(path.join(nested, "index.ts"), ctx),
          }),
        ),
      ).toBe(dir)
    }),
  )

  it.instance("does not activate Biome without a Biome config", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      expect(
        yield* Effect.promise(async () =>
          await withTestInstance({
            directory: dir,
            fn: (ctx) => LSPServer.Biome.root(path.join(dir, "index.ts"), ctx),
          }),
        ),
      ).toBeUndefined()
    }),
  )

  it.instance(
    "does not spawn builtin LSP when explicitly disabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: false } },
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when lsp is true",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance(
    "publishes lsp.updated after custom LSP initialization",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const lsp = yield* LSP.Service
        const updated = yield* Deferred.make<void>()
        const events = yield* EventV2Bridge.Service
        const unsubscribe = yield* events.listen((event) => {
          if (event.type === LSP.Event.Updated.type) Deferred.doneUnsafe(updated, Effect.void)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        const file = path.join(dir, "sample.repro")
        yield* Effect.promise(() => Bun.write(file, "sample\n"))
        yield* lsp.touchFile(file)
        yield* awaitWithTimeout(Deferred.await(updated), "lsp.updated event was not published")
      }),
    {
      config: {
        lsp: {
          fake: {
            command: [process.execPath, fakeServerPath],
            extensions: [".repro"],
          },
        },
      },
    },
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when config object is provided",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    {
      config: {
        lsp: {
          eslint: { disabled: true },
        },
      },
    },
  )

  it.instance(
    "uses pyright instead of ty by default",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(0)
            expect(pyright).toHaveBeenCalledTimes(1)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  experimentalTyIt.instance(
    "uses ty instead of pyright when experimentalLspTy is enabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(1)
            expect(pyright).toHaveBeenCalledTimes(0)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  disabledDownloadIt.instance(
    "passes disableLspDownload to builtin LSP spawn",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(pyright).toHaveBeenCalledTimes(1)
            expect(pyright.mock.calls[0]?.[2]).toMatchObject({ disableLspDownload: true })
          } finally {
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )
})
