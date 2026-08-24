import { describe, expect } from "bun:test"
import { Effect } from "effect"
import type { PluginContext } from "@reddb-io/redcode-plugin/v2/effect"
import { AgentV2 } from "@reddb-io/redcode-core/agent"
import { PluginV2 } from "@reddb-io/redcode-core/plugin"
import { CordisPluginHost } from "@reddb-io/redcode-core/plugin/cordis"
import { State } from "@reddb-io/redcode-core/state"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("CordisPluginHost", () => {
  it.effect("applies profiles in order and awaits Effect teardown", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* PluginV2.Service
        const cordis = yield* CordisPluginHost.make(plugins)
        const lifecycle: string[] = []
        const entry = (id: string) => ({
          id: PluginV2.ID.make(id),
          effect: () =>
            Effect.acquireRelease(
              Effect.sync(() => lifecycle.push(`mount:${id}`)),
              () => Effect.sync(() => lifecycle.push(`unmount:${id}`)),
            ).pipe(Effect.asVoid),
        })

        yield* cordis.apply({ name: "base", entries: [entry("first"), entry("second")] })
        expect(yield* plugins.list()).toEqual([PluginV2.ID.make("first"), PluginV2.ID.make("second")])
        expect(yield* cordis.snapshot).toEqual({
          name: "base",
          entries: [PluginV2.ID.make("first"), PluginV2.ID.make("second")],
        })

        yield* cordis.apply({ name: "patched", entries: [entry("second"), entry("third")] })
        expect(yield* plugins.list()).toEqual([PluginV2.ID.make("second"), PluginV2.ID.make("third")])
        expect(lifecycle).toEqual([
          "mount:first",
          "mount:second",
          "unmount:first",
          "unmount:second",
          "mount:second",
          "mount:third",
        ])

        yield* cordis.clear
        expect(yield* plugins.list()).toEqual([])
      }),
    ),
  )

  it.effect("rolls back the previous profile when a replacement fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* PluginV2.Service
        const agents = yield* AgentV2.Service
        const cordis = yield* CordisPluginHost.make(plugins)
        const stable = {
          id: PluginV2.ID.make("stable"),
          effect: (ctx: PluginContext) =>
            ctx.agent
              .transform((draft) =>
                draft.update("configured", (agent) => {
                  agent.description = "stable"
                }),
              )
              .pipe(Effect.asVoid),
        }

        yield* cordis.apply({ name: "stable", entries: [stable] })
        const failed = yield* cordis
          .apply({
            name: "broken",
            entries: [stable, { id: PluginV2.ID.make("broken"), effect: () => Effect.die("boom") }],
          })
          .pipe(Effect.exit)

        expect(failed._tag).toBe("Failure")
        expect(yield* plugins.list()).toEqual([PluginV2.ID.make("stable")])
        expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("stable")
        expect(yield* cordis.snapshot).toEqual({ name: "stable", entries: [PluginV2.ID.make("stable")] })
      }),
    ),
  )

  it.effect("batches profile state materialization across plugin boundaries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* PluginV2.Service
        const cordis = yield* CordisPluginHost.make(plugins)
        let reloads = 0
        const values = State.create({
          initial: () => [] as string[],
          draft: (state) => ({ add: (value: string) => state.push(value) }),
          finalize: () =>
            Effect.sync(() => {
              reloads++
            }),
        })
        const entry = (id: string) => ({
          id: PluginV2.ID.make(id),
          effect: () =>
            values
              .transform((draft) => {
                draft.add(id)
              })
              .pipe(Effect.asVoid),
        })
        yield* cordis.apply({ name: "batched", entries: [entry("first"), entry("second"), entry("third")] })

        expect(values.get()).toEqual(["first", "second", "third"])
        expect(reloads).toBe(1)

        yield* cordis.clear
        expect(values.get()).toEqual([])
        expect(reloads).toBe(2)
      }),
    ),
  )
})
