import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ExternalDelegation } from "@opencode/core/external-delegation"
import { ExternalDelegationTool } from "@opencode/core/tool/plugin/external-delegation"
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

const it = testEffect(Layer.merge(PluginTestLayer, ExternalDelegation.layer))

it.effect("native tool routes explicit harness delegation through its owning session", () =>
  Effect.gen(function* () {
    const gateway = yield* ExternalDelegation.Service
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const seen: Array<{ session: string; directory: string; driver: string; task: string }> = []
    gateway.set({
      delegate: async (session, directory, request) => {
        seen.push({ session, directory, driver: request.driver, task: request.task })
        return { taskID: request.requestID, status: "running" }
      },
      status: (session, taskID) => ({ session, taskID, status: "completed" }),
      cancel: async (_session, taskID) => ({ taskID, status: "interrupted" }),
    })
    yield* ExternalDelegationTool.Plugin.effect(yield* PluginHost.make(plugins))
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const result = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call-native-delegate",
        name: "external_delegate",
        input: { action: "delegate", driver: "claude", task: "Review the diff" },
      },
    })
    expect(result.status).toBe("completed")
    expect(seen).toEqual([
      { session: session.id, directory: location.directory, driver: "claude", task: "Review the diff" },
    ])
    expect(JSON.stringify(result.output)).toContain("running")
  }),
)

const denied = testEffect(
  Layer.merge(
    makePluginTestLayer(
      permissionLayer({
        assert: (input) =>
          Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
      }),
    ),
    ExternalDelegation.layer,
  ),
)

denied.effect("a denied native delegation does not start the external harness", () =>
  Effect.gen(function* () {
    const gateway = yield* ExternalDelegation.Service
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const calls: string[] = []
    gateway.set({
      delegate: async () => {
        calls.push("started")
        return {}
      },
      status: () => ({}),
      cancel: async () => ({}),
    })
    yield* ExternalDelegationTool.Plugin.effect(yield* PluginHost.make(plugins))
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const result = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call-denied",
        name: "external_delegate",
        input: { action: "delegate", driver: "codex", task: "Review" },
      },
    })
    expect(result.status).toBe("error")
    expect(calls).toEqual([])
  }),
)
