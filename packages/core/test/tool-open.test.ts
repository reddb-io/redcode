import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OpenTool } from "@opencode/core/tool/plugin/open"
import { Agent } from "@opencode/schema/agent"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "./lib/tool"

const openToolNode = makeLocationNode({
  name: "test/open-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(OpenTool.Plugin)),
  deps: [Tool.node, FileAccess.node, Environment.node, Location.node, Permission.node],
})

const sessionID = Session.ID.make("ses_open_tool_test")

const withTool = <A, E, R>(
  directory: string,
  assertions: Permission.AssertInput[],
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, openToolNode]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })),
      ]),
    ),
  )

const call = (file: string, id = "call-open") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "open", input: { path: file } },
})

const it = testEffect(Layer.empty)

describe("OpenTool", () => {
  // The test preload sets REDCODE_NO_BROWSER, so the system opener never runs; the refusal shows the tool got there.
  it.live("asks to open a file or directory, then hands it to the system opener", () =>
    withTempDir((tmp) => {
      const assertions: Permission.AssertInput[] = []
      return withTool(tmp.path, assertions, (registry) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "exports"), { recursive: true })
            await fs.writeFile(path.join(tmp.path, "exports", "deck.pdf"), "%PDF")
          })
          for (const target of ["exports/deck.pdf", "exports"]) {
            const result = yield* executeTool(registry, call(target, `call-${target}`))
            expect(JSON.stringify(result)).toContain("Opening files is disabled on this host")
          }
          expect(assertions.map((item) => [item.action, item.resources])).toEqual([
            ["open", ["exports/deck.pdf"]],
            ["open", ["exports"]],
          ])
        }),
      )
    }),
  )

  it.live("refuses programs and scripts, and missing paths, before asking anything", () =>
    withTempDir((tmp) => {
      const assertions: Permission.AssertInput[] = []
      return withTool(tmp.path, assertions, (registry) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "setup.ps1"), "Remove-Item -Recurse"))
          expect(JSON.stringify(yield* executeTool(registry, call("setup.ps1")))).toContain("program or script")
          expect(JSON.stringify(yield* executeTool(registry, call("missing.txt", "call-missing")))).toContain(
            "not a file or directory",
          )
          expect(assertions).toEqual([])
        }),
      )
    }),
  )

  it.effect("asks before opening by default", () =>
    Effect.sync(() => {
      expect(Agent.Info.default(Agent.ID.make("build")).permissions).toContainEqual({
        action: "open",
        resource: "*",
        effect: "ask",
      })
    }),
  )
})
