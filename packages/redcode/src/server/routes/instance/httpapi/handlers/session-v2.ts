import { SessionV2 } from "@reddb-io/redcode-core/session"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ConflictError, SessionNotFoundError } from "@reddb-io/redcode-protocol/errors"
import { SessionV2PromptPayload } from "@reddb-io/redcode-protocol/groups/session-v2"

export const sessionV2Handlers = HttpApiBuilder.group(RootHttpApi, "server.sessionV2", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service

    const prompt = Effect.fn("SessionV2HttpApi.prompt")(function* (ctx) {
      return yield* sessions
        .prompt({
          sessionID: ctx.payload.sessionID,
          prompt: ctx.payload.prompt,
          ...(ctx.payload.id ? { id: ctx.payload.id } : {}),
          ...(ctx.payload.delivery ? { delivery: ctx.payload.delivery } : {}),
          ...(ctx.payload.resume === undefined ? {} : { resume: ctx.payload.resume }),
        })
        .pipe(
          Effect.mapError((error) => {
            if (error instanceof SessionV2.NotFoundError)
              return new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` })
            if (error instanceof SessionV2.PromptConflictError)
              return new ConflictError({ message: error.message })
            return new ConflictError({ message: error.message })
          }),
        )
    })

    const session = Effect.fn("SessionV2HttpApi.session")(function* (ctx) {
      return yield* sessions.get(ctx.params.id).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const messages = Effect.fn("SessionV2HttpApi.messages")(function* (ctx) {
      return yield* sessions.messages({ sessionID: ctx.params.id }).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const events = Effect.fn("SessionV2HttpApi.events")(function* (ctx) {
      const page = yield* sessions
        .history({
          sessionID: ctx.params.id,
          ...(ctx.query?.after !== undefined ? { after: ctx.query.after } : {}),
          limit: 500,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
          ),
        )
      return page.events
    })

    const interrupt = Effect.fn("SessionV2HttpApi.interrupt")(function* (ctx) {
      yield* sessions.interrupt(ctx.params.id)
    })

    return handlers
      .handle("sessionV2.prompt", prompt)
      .handle("sessionV2.session", session)
      .handle("sessionV2.messages", messages)
      .handle("sessionV2.interrupt", interrupt)
      .handle("sessionV2.events", events)
  }),
)
