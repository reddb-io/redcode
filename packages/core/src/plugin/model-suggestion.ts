export * as ModelSuggestionPlugin from "./model-suggestion.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { Effect } from "effect"
import { Config } from "../config.js"
import { Model } from "../model.js"
import { Session } from "../session.js"
import { SessionModelSuggestion } from "../session/model-suggestion.js"

/**
 * Records a RedRouter model suggestion on the session when a `recommend_models` call returns one,
 * unless `experimental.model_suggestions` is false. Clients show it as a card; the session's model
 * only changes when the person accepts it.
 */
export const Plugin = define({
  id: "redcode.model-suggestion",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const models = yield* Model.Service
    const sessions = yield* Session.Service
    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed" || !event.tool.endsWith(`_${SessionModelSuggestion.TOOL}`)) return Effect.void
      const output = event.result.output
      return Effect.gen(function* () {
        if (Config.latestExperimental(yield* config.entries(), "model_suggestions") === false) return
        const session = yield* sessions.get(event.sessionID)
        const current = session.model
        if (!current) return
        const suggestion = SessionModelSuggestion.suggest({
          args: event.input,
          output,
          current,
          models: yield* models.available(),
        })
        if (!suggestion) return
        const metadata = ModelSuggestion.offer(session.metadata, suggestion)
        if (!metadata) return
        yield* sessions.setMetadata({ sessionID: event.sessionID, metadata })
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to record a model suggestion", { sessionID: event.sessionID, cause }),
        ),
      )
    })
  }),
})
