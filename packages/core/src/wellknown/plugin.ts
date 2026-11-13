export * as WellKnownPlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Bus } from "../bus.js"
import { WellKnown } from "../wellknown.js"

export const Plugin = define({
  id: "opencode.wellknown",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const wellknown = yield* WellKnown.Service
    yield* wellknown.entries().pipe(Effect.orDie)
    yield* ctx.integration.transform((editor) => {
      wellknown.snapshot().forEach((entry) => {
        if (!entry.manifest.auth) return
        editor.update(entry.integrationID, (integration) => {
          integration.name = new URL(entry.origin).hostname
        })
        editor.method.update({
          integrationID: entry.integrationID,
          method: {
            id: "login",
            type: "command",
            label: "Log in",
            command: [...entry.manifest.auth.command],
          },
        })
      })
    })
    const watch = yield* bus.watch("plugin.wellknown.updated", [WellKnown.Event.Updated], () => ctx.integration.reload())
    yield* watch.pipe(Effect.forkScoped({ startImmediately: true }))
  }),
})
