import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { OperationHook } from "@opencode-ai/core/operation-hook"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { define, Operation } from "@opencode-ai/plugin/v2/promise"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("loads a promise plugin and registers a transform hook", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-example",
        setup: async (ctx) => {
          expect(ctx.options.mode).toBe("strict")
          await ctx.agent.transform((draft) => {
            draft.update("reviewer", (item) => {
              item.description = "Reviews code"
              item.mode = "subagent"
            })
          })
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect({ ...host, options: { mode: "strict" } })

      expect(yield* agents.get(AgentV2.ID.make("reviewer"))).toMatchObject({
        description: "Reviews code",
        mode: "subagent",
      })
    }),
  )

  it.effect("disposes a hook registration on request", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-dispose",
        setup: async (ctx) => {
          const registration = await ctx.agent.transform((draft) => {
            draft.update("temp", (item) => {
              item.description = "temporary"
            })
          })
          await registration.dispose()
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect(host)

      expect(yield* agents.get(AgentV2.ID.make("temp"))).toBeUndefined()
    }),
  )

  it.effect("composes promise waterfall middleware", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const hooks = yield* OperationHook.Service

      yield* PluginPromise.fromPromise(
        define({
          id: "promise-waterfall",
          setup: async (ctx) => {
            await ctx.hook.waterfall(Operation.Text.Complete, async (event, next) => {
              const result = await next({ ...event.data, text: `${event.data.text}:before` })
              return { ...result, text: `${result.text}:after` }
            })
          },
        }),
      ).effect(host)

      const result = yield* hooks.waterfall(Operation.Text.Complete, {
        timestamp: yield* DateTime.now,
        sessionID: "session",
        messageID: "message",
        partID: "part",
        text: "original",
      })
      expect(result.text).toBe("original:before:after")
    }),
  )
})
