import { expect } from "bun:test"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { SessionArtifactTool } from "@opencode/core/tool/plugin/session-artifact"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/core/session"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Permission } from "@opencode/core/permission"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"
import { makePluginTestLayer, PluginTestLayer } from "./plugin/fixture"
import { permissionLayer } from "./lib/permission"

const it = testEffect(PluginTestLayer)

it.effect("agent publishes an artifact to its own session through its tool", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const folder = path.join(location.directory, `artifact-test-${crypto.randomUUID()}`)
    yield* Effect.promise(() => mkdir(folder, { recursive: true }))
    yield* Effect.promise(() => Bun.write(path.join(folder, "index.html"), "<h1>Report</h1>"))
    yield* SessionArtifactTool.Plugin.effect(yield* PluginHost.make(plugins))
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const result = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "artifact-publish",
        name: "session_artifact",
        input: {
          action: "publish",
          source: path.basename(folder),
          title: "Report",
          entry: "index.html",
        },
      },
    })
    expect(result.status).toBe("completed")
    expect(JSON.stringify(result.output)).toContain(session.id)
    const list = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: { type: "tool-call", id: "artifact-list", name: "session_artifact", input: { action: "list" } },
    })
    expect(list.status).toBe("completed")
    expect(JSON.stringify(list.output)).toContain("Report")
  }),
)

const denied = testEffect(
  makePluginTestLayer(
    permissionLayer({
      assert: (input) =>
        Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
    }),
  ),
)

denied.effect("agent publication respects a denied artifact permission", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    yield* SessionArtifactTool.Plugin.effect(yield* PluginHost.make(plugins))
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const result = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "artifact-denied",
        name: "session_artifact",
        input: {
          action: "publish",
          source: "not-read",
          title: "Report",
          entry: "index.html",
        },
      },
    })
    expect(result.status).toBe("error")
  }),
)
