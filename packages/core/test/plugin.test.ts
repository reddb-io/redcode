import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Fiber } from "effect"
import { define, Operation } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OperationHook } from "@opencode-ai/core/operation-hook"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

describe("PluginV2", () => {
  it.effect("waits for a plugin and returns immediately once active", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("waited")
      const waiting = yield* plugins.wait(id).pipe(Effect.forkChild)

      yield* plugins.add(id, () => Effect.void)
      yield* Fiber.join(waiting)
      yield* plugins.wait(id)
    }),
  )

  it.effect("propagates plugin activation defects to waiters", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("failed")
      const waiting = yield* plugins.wait(id).pipe(Effect.exit, Effect.forkChild)

      const added = yield* plugins.add(id, () => Effect.die("boom")).pipe(Effect.exit)
      const pending = yield* Fiber.join(waiting)
      const later = yield* plugins.wait(id).pipe(Effect.exit)

      expect(Exit.isFailure(added)).toBe(true)
      expect(Exit.isFailure(pending)).toBe(true)
      expect(Exit.isFailure(later)).toBe(true)
    }),
  )

  it.effect("adds, replaces, and removes plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let description = "first"

      const managed = () =>
        define({
          id: "managed",
          effect: (ctx) =>
            ctx.agent
              .transform((agents) =>
                agents.update("configured", (agent) => {
                  agent.description = description
                }),
              )
              .pipe(Effect.asVoid),
        })

      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")
      expect(yield* plugins.list()).toEqual([PluginV2.ID.make("managed")])

      description = "second"
      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      yield* plugins.remove(PluginV2.ID.make("managed"))
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
      expect(yield* plugins.list()).toEqual([])
    }),
  )

  it.effect("keeps plugin inventory order stable across replacement", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const first = PluginV2.ID.make("first")
      const second = PluginV2.ID.make("second")

      yield* plugins.add(first, () => Effect.void)
      yield* plugins.add(second, () => Effect.void)
      yield* plugins.add(first, () => Effect.void)

      expect(yield* plugins.list()).toEqual([first, second])
    }),
  )

  it.effect("disposes operation hooks when a plugin is removed", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const hooks = yield* OperationHook.Service
      const id = PluginV2.ID.make("operation-hook")
      yield* plugins.add(
        id,
        define({
          id,
          effect: (ctx) =>
            ctx.hook
              .waterfall(Operation.Text.Complete, (event) => ({ ...event.data, text: "plugin" }))
              .pipe(Effect.asVoid),
        }).effect,
      )

      const input = {
        timestamp: yield* DateTime.now,
        sessionID: "session",
        messageID: "message",
        partID: "part",
        text: "original",
      }
      expect((yield* hooks.waterfall(Operation.Text.Complete, input)).text).toBe("plugin")

      yield* plugins.remove(id)
      expect((yield* hooks.waterfall(Operation.Text.Complete, input)).text).toBe("original")
    }),
  )
})
