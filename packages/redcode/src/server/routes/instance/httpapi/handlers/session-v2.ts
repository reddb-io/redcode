import { SessionV2 } from "@reddb-io/redcode-core/session"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ConflictError, SessionNotFoundError } from "@reddb-io/redcode-protocol/errors"
import { SessionV2PromptPayload } from "@reddb-io/redcode-protocol/groups/session-v2"

export const sessionV2Handlers = HttpApiBuilder.group(RootHttpApi, "server.sessionV2", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service

    const prompt = Effect.fn("SessionV2HttpApi.prompt")(function* (ctx: {
      payload: typeof SessionV2PromptPayload.Type
    }) {
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

    const session = Effect.fn("SessionV2HttpApi.session")(function* (ctx: { path: { id: SessionV2.ID } }) {
      return yield* sessions.get(ctx.path.id).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const messages = Effect.fn("SessionV2HttpApi.messages")(function* (ctx: { path: { id: SessionV2.ID } }) {
      return yield* sessions.messages({ sessionID: ctx.path.id }).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const events = Effect.fn("SessionV2HttpApi.events")(function* (ctx: {
      path: { id: SessionV2.ID }
      urlParams: { after?: number }
    }) {
      return yield* sessions
        .events({ sessionID: ctx.path.id, ...(ctx.urlParams.after !== undefined ? { after: ctx.urlParams.after } : {}) })
        .pipe(
          Effect.mapError(
            (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
          ),
          Effect.flatMap(Stream.runCollect),
          Effect.map((chunk) => Array.from(chunk)),
        )
    })

    const interrupt = Effect.fn("SessionV2HttpApi.interrupt")(function* (ctx: { path: { id: SessionV2.ID } }) {
      yield* sessions.interrupt(ctx.path.id)
    })

    return handlers
      .handle("prompt", prompt)
      .handle("session", session)
      .handle("messages", messages)
      .handle("events", events)
      .handle("interrupt", interrupt)
  }),
)
