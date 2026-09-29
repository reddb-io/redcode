export * as ModelSuggestionPlugin from "./model-suggestion.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { Effect, Scope } from "effect"
import { Config } from "../config.js"
import { Mcp } from "../mcp/index.js"
import { Model } from "../model.js"
import { Session } from "../session.js"
import { SessionModelSuggestion } from "../session/model-suggestion.js"
import { SessionSchema } from "../session/schema.js"

/**
 * The provider the RedRouter provider plugin connects under, and whose MCP server it registers. A
 * model of any other provider is never the subject of a suggestion Redcode asks for itself.
 */
const ROUTER = "red-router"

/**
 * Records a RedRouter model suggestion on the session, unless `experimental.model_suggestions` is
 * false. The router is asked when the agent calls `recommend_models`, and by Redcode itself when a
 * step of a RedRouter model fires a trigger (images or tools the model cannot handle, a context near
 * its limit, a cheaper equivalent in the catalog) or its provider fails (out of quota, unavailable
 * for a while, or failing repeatedly). Asking never blocks or fails the step: it runs in the
 * background, once per trigger and situation, and not for a trigger the person kept the model for.
 * Clients show the suggestion as a card; the session's model only changes when the person accepts it.
 */
export const Plugin = define({
  id: "redcode.model-suggestion",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const models = yield* Model.Service
    const sessions = yield* Session.Service
    const mcp = yield* Mcp.Service
    const scope = yield* Scope.Scope
    const tracked = SessionModelSuggestion.tracker()

    const enabled = Effect.fnUntraced(function* () {
      return Config.latestExperimental(yield* config.entries(), "model_suggestions") !== false
    })

    const record = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      suggest: (current: Model.Ref, listed: readonly Model.Info[]) => ModelSuggestion.Info | undefined,
    ) {
      const session = yield* sessions.get(sessionID)
      if (!session.model) return
      const suggestion = suggest(session.model, yield* models.available())
      if (!suggestion) return
      const metadata = ModelSuggestion.offer(session.metadata, suggestion)
      if (!metadata) return
      yield* sessions.setMetadata({ sessionID, metadata })
    })

    // Asks the router in the background for a trigger that is still open for the session.
    const ask = (input: {
      readonly sessionID: SessionSchema.ID
      readonly model: Model.Ref
      readonly request: SessionModelSuggestion.Request
      readonly key: string
    }) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(input.sessionID)
        if (ModelSuggestion.read(session.metadata).kept?.includes(input.request.trigger)) return
        if (!tracked.claim(input.sessionID, input.request.trigger, input.key)) return
        const suggestion = yield* SessionModelSuggestion.ask({
          request: input.request,
          current: input.model,
          models: yield* models.available(),
        }).pipe(Effect.provideService(Mcp.Service, mcp))
        if (!suggestion) return
        // The person may have changed the model while the router was answering.
        yield* record(input.sessionID, (current) =>
          current.providerID === input.model.providerID && current.id === input.model.id ? suggestion : undefined,
        )
      })

    const background = (sessionID: SessionSchema.ID, work: Effect.Effect<void, unknown>) =>
      work.pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("failed to ask RedRouter for a model suggestion", { sessionID, cause }),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      )

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed" || !event.tool.endsWith(`_${SessionModelSuggestion.TOOL}`)) return Effect.void
      const output = event.result.output
      return Effect.gen(function* () {
        if (!(yield* enabled())) return
        yield* record(event.sessionID, (current, listed) =>
          SessionModelSuggestion.suggest({ args: event.input, output, current, models: listed }),
        )
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to record a model suggestion", { sessionID: event.sessionID, cause }),
        ),
      )
    })

    yield* ctx.session.hook(
      "context",
      (event) => {
        // Read now: later hooks may still change what this step sends.
        const needs = SessionModelSuggestion.needsOf({
          messages: event.messages,
          tools: Object.keys(event.tools).length > 0,
        })
        return background(
          event.sessionID,
          Effect.gen(function* () {
            if (!(yield* enabled())) return
            const model = yield* models.get(event.model.providerID, event.model.id)
            if (!model) return
            // The latest answer of this very model measures the context in use.
            const answers = yield* sessions.messages({ sessionID: event.sessionID, type: "assistant", limit: 3 })
            const latest = answers.find((message) => message.type === "assistant" && message.tokens !== undefined)
            const tokens =
              latest?.type === "assistant" &&
              latest.model.providerID === event.model.providerID &&
              latest.model.id === event.model.id
                ? SessionModelSuggestion.contextInUse(latest.tokens)
                : undefined
            const found = SessionModelSuggestion.detect({ model, needs, tokens })
            if (found)
              return yield* ask({ sessionID: event.sessionID, model: event.model, request: found, key: model.id })
            // A cheaper equivalent is looked for once per session, after the model has answered once.
            if (tokens === undefined) return
            const request = SessionModelSuggestion.cheaper({ model, models: yield* models.available(), needs })
            if (request) yield* ask({ sessionID: event.sessionID, model: event.model, request, key: "session" })
          }),
        )
      },
      { providerID: ROUTER },
    )

    yield* ctx.session.hook(
      "retry",
      (event) => {
        const failure = SessionModelSuggestion.failureOf(event.error, event.decision.retry)
        if (!failure) return Effect.void
        const failures = tracked.fail(event.sessionID)
        return background(
          event.sessionID,
          Effect.gen(function* () {
            if (!(yield* enabled())) return
            const model = yield* models.get(event.model.providerID, event.model.id)
            if (!model) return
            const request = SessionModelSuggestion.afterFailure({ model, failure, failures })
            if (request) yield* ask({ sessionID: event.sessionID, model: event.model, request, key: model.id })
          }),
        )
      },
      { providerID: ROUTER },
    )

    yield* ctx.session.hook(
      "http.response",
      (event) =>
        Effect.sync(() => {
          if (event.kind === "primary" && event.response.ok) tracked.recover(event.sessionID)
        }),
      { providerID: ROUTER },
    )
  }),
})
