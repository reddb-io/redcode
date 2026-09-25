import { Session } from "@/session/session"
import { SessionModelSuggestion } from "@/session/model-suggestion"
import type { SessionID } from "@/session/schema"
import type { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { mapStorageNotFound } from "./session-errors"

export const modelSuggestionHandlers = HttpApiBuilder.group(InstanceHttpApi, "modelSuggestion", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const suggestions = yield* SessionModelSuggestion.Service

    const resolve = Effect.fn("ModelSuggestionHttpApi.resolve")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: { trigger: ModelSuggestion.Trigger; choice: ModelSuggestion.Choice }
    }) {
      yield* mapStorageNotFound(sessions.get(ctx.params.sessionID))
      return yield* suggestions.resolve({
        sessionID: ctx.params.sessionID,
        trigger: ctx.payload.trigger,
        choice: ctx.payload.choice,
      })
    })

    return handlers.handle("resolve", resolve)
  }),
)
