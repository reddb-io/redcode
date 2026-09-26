import { Schema } from "effect"
import { Context } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Prompt } from "@reddb-io/redcode-schema/prompt"
import { Admitted, Delivery } from "@reddb-io/redcode-schema/session-input"
import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { SessionDelivery } from "@reddb-io/redcode-schema/session-delivery"
import { SessionID } from "@reddb-io/redcode-schema/session-id"
import { SessionEvent } from "@reddb-io/redcode-schema/session-event"
import { Session } from "@reddb-io/redcode-schema/session"
import { ConflictError, InvalidRequestError, SessionNotFoundError } from "../errors"

const root = "/experimental/session-v2"

export const SessionV2PromptPayload = Schema.Struct({
  sessionID: SessionID,
  prompt: Prompt,
  id: SessionMessage.ID.pipe(Schema.optional),
  delivery: Delivery.pipe(Schema.optional),
  resume: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SessionV2PromptPayload" })

export const SessionV2EventsQuery = Schema.Struct({
  after: Schema.optional(Schema.NumberFromString),
}).annotate({ identifier: "SessionV2EventsQuery" })

export const makeSessionV2Group = <I extends HttpApiMiddleware.AnyId, S>(sessionLocationMiddleware: Context.Key<I, S>) =>
  HttpApiGroup.make("server.sessionV2")
    .add(
      HttpApiEndpoint.post("sessionV2.prompt", `${root}/prompt`, {
        payload: SessionV2PromptPayload,
        success: Admitted,
        error: [InvalidRequestError, SessionNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.prompt",
          summary: "Prompt a session through the V2 runtime",
          description:
            "Admits one durable prompt row and schedules the V2 session drain. The prompt becomes a user message at a safe provider-turn boundary.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("sessionV2.session", `${root}/:id`, {
        params: { id: SessionID },
        success: Session.Info,
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.read",
          summary: "Read a V2 session",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("sessionV2.messages", `${root}/:id/messages`, {
        params: { id: SessionID },
        success: Schema.Array(SessionMessage.Message),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.messages",
          summary: "Read a V2 session's messages",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("sessionV2.events", `${root}/:id/events`, {
        params: { id: SessionID },
        query: SessionV2EventsQuery,
        success: Schema.Array(SessionEvent.Durable),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.events",
          summary: "Read a V2 session's durable events",
          description: "Events after the `after` sequence, oldest first.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("sessionV2.interrupt", `${root}/:id/interrupt`, {
        params: { id: SessionID },
        success: HttpApiSchema.NoContent,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.interrupt",
          summary: "Interrupt a running V2 session",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({ title: "sessionV2", description: "V2 session runtime routes (experimental)." }),
    )
    .middleware(sessionLocationMiddleware)
