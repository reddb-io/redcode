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

    const session = Effect.fn("SessionV2HttpApi.session")(function* (ctx: { params: { id: SessionV2.ID } }) {
      return yield* sessions.get(ctx.params.id).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const messages = Effect.fn("SessionV2HttpApi.messages")(function* (ctx: { params: { id: SessionV2.ID } }) {
      return yield* sessions.messages({ sessionID: ctx.params.id }).pipe(
        Effect.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      )
    })

    const events = Effect.fn("SessionV2HttpApi.events")(function* (ctx: {
      params: { id: SessionV2.ID }
      urlParams: { after?: number }
    }) {
      const stream = sessions.events({
        sessionID: ctx.params.id,
        ...(ctx.urlParams.after !== undefined ? { after: ctx.urlParams.after } : {}),
      })
      const chunk = yield* stream.pipe(
        Stream.mapError(
          (error) => new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
        Stream.runCollect,
      )
      return Array.from(chunk).map((event) => ({
        type: event.type,
        ...(event.data as Record<string, unknown>),
      }))
    })

    const interrupt = Effect.fn("SessionV2HttpApi.interrupt")(function* (ctx: { params: { id: SessionV2.ID } }) {
      yield* sessions.interrupt(ctx.params.id)
    })

    return handlers
      .handle("sessionV2.prompt", prompt)
      .handle("sessionV2.session", session)
      .handle("sessionV2.messages", messages)
      .handle("sessionV2.events", events)
      .handle("sessionV2.interrupt", interrupt)
  }),
)
