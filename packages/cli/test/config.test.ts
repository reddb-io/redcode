import { NodeFileSystem } from "@effect/platform-node"
import { Flock } from "@opencode/util/flock"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem, Option, Schema } from "effect"
import { expect, test } from "bun:test"
import { applyEdits, modify, parse } from "jsonc-parser"
import path from "path"
import { Config } from "../src/config"
import { tmpdir } from "./fixture/tmpdir"

function run<A, E>(directory: string, effect: Effect.Effect<A, E, Config.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Config.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

test("generates reusable keybind schemas and preserves descriptions and numeric constraints", () => {
  const document = Schema.toJsonSchemaDocument(Config.Info)
  expect(document).toHaveProperty(["definitions", "TuiKeybind.BindingValue"])
  expect(document).toHaveProperty(["schema", "properties", "keybinds", "anyOf", 0, "properties", "app.exit"], {
    anyOf: [{ $ref: "#/$defs/TuiKeybind.BindingValue" }, { type: "null" }],
    description: "Exit the application",
  })
  expect(document).toHaveProperty(["schema", "properties", "scroll", "anyOf", 0, "properties", "speed", "anyOf", 0], {
    type: "number",
    minimum: 0.001,
  })
  expect(document).toHaveProperty(
    ["schema", "properties", "attention", "anyOf", 0, "properties", "volume", "anyOf", 0],
    { type: "number", minimum: 0, maximum: 1 },
  )
})

test("includes the published schema when creating cli.json", async () => {
  await using directory = await tmpdir()

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.update((draft) => {
        draft.animations = false
      })
    }),
  )

  expect(config).toEqual({ $schema: "https://opencode.ai/v2/cli.json", animations: false })
  expect(await Bun.file(path.join(directory.path, "cli.json")).json()).toEqual(config)
})

test("preserves the schema in an existing cli.json", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ $schema: "https://opencode.ai/v2/cli.json", animations: true }))

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.update((draft) => {
        draft.animations = false
      })
    }),
  )

  expect(config).toEqual({ $schema: "https://opencode.ai/v2/cli.json", animations: false })
  expect(await Bun.file(file).json()).toEqual(config)
})

test("merges inline CLI config content over the global config", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  const previous = process.env.OPENCODE_CLI_CONFIG_CONTENT
  await Bun.write(
    file,
    JSON.stringify({
      tabs: { mode: "on", scope: "global" },
      keybinds: { "app.exit": "ctrl+q" },
      plugins: ["global"],
      animations: true,
    }),
  )
  process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({
    tabs: { mode: "off" },
    keybinds: { "help.show": false },
    plugins: ["inline"],
    animations: false,
  })

  try {
    const result = await run(
      directory.path,
      Effect.gen(function* () {
        const service = yield* Config.Service
        const loaded = yield* service.get()
        const updated = yield* service.update((draft) => {
          draft.animations = true
          draft.mouse = false
        })
        return { loaded, updated }
      }),
    )

    expect(result.loaded.tabs).toEqual({ mode: "off", scope: "global" })
    expect(result.loaded.keybinds).toEqual({ "app.exit": "ctrl+q", "help.show": false })
    expect(result.loaded.plugins).toEqual(["inline"])
    expect(result.updated).toMatchObject({ animations: false, mouse: false })
    expect(await Bun.file(file).json()).toMatchObject({ animations: true, mouse: false })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CLI_CONFIG_CONTENT
    else process.env.OPENCODE_CLI_CONFIG_CONTENT = previous
  }
})

test("config reads remain interruptible while waiting for the file lock", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  const locks = path.join(directory.path, "locks")
  const held = await Flock.acquire(file, { dir: locks })

  try {
    const service = await Effect.runPromise(
      Config.Service.pipe(
        Effect.provide(Config.layer),
        Effect.provide(Global.layerWith({ config: directory.path, state: directory.path })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    const result = Effect.runPromise(service.get().pipe(Effect.timeoutOption("50 millis")))
    expect(await Promise.race([result, Bun.sleep(250).then(() => "blocked" as const)])).toEqual(Option.none())
  } finally {
    await held.release()
  }
})

test("updates effective duplicate canonical keybinds", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(
    file,
    `{"keybinds":{"session.delete":"first","session.delete":"last","opencode.settings":"off","opencode.settings":"on"}}`,
  )

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      expect((yield* service.get()).keybinds).toEqual({ "session.delete": "last", "opencode.settings": "on" })
      return yield* service.update((draft) => {
        draft.keybinds = { ...draft.keybinds, "session.delete": "changed", "opencode.settings": "changed" }
      })
    }),
  )

  expect(config.keybinds).toEqual({ "session.delete": "changed", "opencode.settings": "changed" })
  expect(parse(await Bun.file(file).text()).keybinds).toEqual({
    "session.delete": "changed",
    "opencode.settings": "changed",
  })
})

test("updates a config draft while preserving JSONC comments", async () => {
  await using directory = await tmpdir()
  await Bun.write(path.join(directory.path, "cli.json"), '{\n  // Keep this comment\n  "animations": true\n}\n')

  const config = await run(
    directory.path,
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.update((draft) => {
        draft.prompt = { paste: "compact" }
        draft.mini = {
          thinking: "hide",
          shell_output: "hide",
          turn_summary: "hide",
          splash: "hide",
          work_spinner: "block-low-comet",
          mono: true,
        }
      })
    }),
  )

  expect(config).toEqual({
    animations: true,
    prompt: { paste: "compact" },
    mini: {
      thinking: "hide",
      shell_output: "hide",
      turn_summary: "hide",
      splash: "hide",
      work_spinner: "block-low-comet",
      mono: true,
    },
  })
  expect(await Bun.file(path.join(directory.path, "cli.json")).text()).toContain("// Keep this comment")
})

test("does not rewrite or implicitly convert older CLI settings", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  const source = '{"tabs":{"enabled":false}}'
  await Bun.write(file, source)
  await expect(
    run(
      directory.path,
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  ).rejects.toThrow("redcode migrate")
  expect(await Bun.file(file).text()).toBe(source)
})
