import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileMutation } from "@opencode/core/file-mutation"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { CopyTool } from "@opencode/core/tool/plugin/copy"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "./lib/tool"

const copyToolNode = makeLocationNode({
  name: "test/copy-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(CopyTool.Plugin)),
  deps: [Tool.node, Bus.node, FileAccess.node, FileMutation.node, Environment.node, Location.node, Permission.node],
})

const sessionID = Session.ID.make("ses_copy_tool_test")

const withTool = <A, E, R>(
  directory: string,
  fixture: { assertions: Permission.AssertInput[]; denyAction?: string },
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, Bus.node, FileAccess.node, FileMutation.node, copyToolNode]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Permission.node.replace(
          permissionLayer({
            assert: (input) =>
              Effect.sync(() => fixture.assertions.push(input)).pipe(
                Effect.andThen(
                  input.action === fixture.denyAction
                    ? Effect.fail(
                        new Permission.BlockedError({
                          rules: [],
                          permission: input.action,
                          resources: input.resources,
                        }),
                      )
                    : Effect.void,
                ),
              ),
          }),
        ),
      ]),
    ),
  )

const call = (input: typeof CopyTool.Input.Type, id = "call-copy") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "copy", input },
})

const read = (file: string) => Effect.promise(() => fs.readFile(file))
const write = (file: string, content: string | Uint8Array) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  })

const it = testEffect(Layer.empty)

describe("CopyTool", () => {
  it.live("copies a binary file into an existing directory under its own name, after read and edit approval", () =>
    withTempDir((tmp) => {
      const fixture = { assertions: [] as Permission.AssertInput[] }
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10])
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          yield* write(path.join(tmp.path, "inbox", "logo.png"), png)
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "slides", "assets"), { recursive: true }))
          expect(
            yield* executeTool(registry, call({ source: "inbox/logo.png", destination: "slides/assets" })),
          ).toMatchObject({
            status: "completed",
            output: { operation: "copy", source: "inbox/logo.png", destination: "slides/assets/logo.png", files: 1 },
          })
          expect(new Uint8Array(yield* read(path.join(tmp.path, "slides", "assets", "logo.png")))).toEqual(png)
          expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
            ["read", ["inbox/logo.png"]],
            ["edit", ["slides/assets/logo.png"]],
          ])
        }),
      )
    }),
  )

  it.live("copies a directory tree to a new path", () =>
    withTempDir((tmp) => {
      const fixture = { assertions: [] as Permission.AssertInput[] }
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          yield* write(path.join(tmp.path, "template", "index.html"), "<main></main>")
          yield* write(path.join(tmp.path, "template", "img", "a.svg"), "<svg/>")
          expect(yield* executeTool(registry, call({ source: "template", destination: "deck/copy" }))).toMatchObject({
            status: "completed",
            output: { source: "template", destination: "deck/copy", files: 2 },
          })
          expect(String(yield* read(path.join(tmp.path, "deck", "copy", "img", "a.svg")))).toBe("<svg/>")
          expect(String(yield* read(path.join(tmp.path, "deck", "copy", "index.html")))).toBe("<main></main>")
        }),
      )
    }),
  )

  it.live("keeps existing files unless overwrite is set, and writes nothing when one would be replaced", () =>
    withTempDir((tmp) => {
      const fixture = { assertions: [] as Permission.AssertInput[] }
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          yield* write(path.join(tmp.path, "a", "one.txt"), "new one")
          yield* write(path.join(tmp.path, "a", "two.txt"), "new two")
          yield* write(path.join(tmp.path, "b", "two.txt"), "old two")
          const refused = yield* executeTool(registry, call({ source: "a", destination: "b" }))
          expect(refused).toMatchObject({ status: "error" })
          expect(JSON.stringify(refused)).toContain("overwrite: true")
          // The refusal comes before any write, so the file that was free to copy was not copied either.
          expect(
            yield* Effect.promise(() =>
              fs.access(path.join(tmp.path, "b", "one.txt")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(String(yield* read(path.join(tmp.path, "b", "two.txt")))).toBe("old two")
          expect(
            yield* executeTool(registry, call({ source: "a", destination: "b", overwrite: true }, "call-again")),
          ).toMatchObject({ status: "completed", output: { files: 2 } })
          expect(String(yield* read(path.join(tmp.path, "b", "two.txt")))).toBe("new two")
        }),
      )
    }),
  )

  it.live("refuses to copy a directory into itself and copies nothing without edit approval", () =>
    withTempDir((tmp) => {
      const fixture = { assertions: [] as Permission.AssertInput[], denyAction: "edit" }
      return withTool(tmp.path, fixture, (registry) =>
        Effect.gen(function* () {
          yield* write(path.join(tmp.path, "src", "a.txt"), "a")
          const nested = yield* executeTool(registry, call({ source: "src", destination: "src/backup" }))
          expect(JSON.stringify(nested)).toContain("cannot be copied into itself")
          expect(
            yield* executeTool(registry, call({ source: "src/a.txt", destination: "out/a.txt" }, "call-denied")),
          ).toMatchObject({
            status: "error",
          })
          expect(
            yield* Effect.promise(() =>
              fs.access(path.join(tmp.path, "out")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
      )
    }),
  )
})
