import { Schema } from "effect"
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

export const SessionV2Group = HttpApiGroup.make("server.sessionV2")
    .add(
      HttpApiEndpoint.post("sessionV2.prompt", `${root}/prompt`, {
        payload: SessionV2PromptPayload,
        success: Admitted,
        error: [InvalidRequestError, SessionNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "sessionV2.prompt",
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
          identifier: "sessionV2.session",
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
          identifier: "sessionV2.messages",
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
          identifier: "sessionV2.events",
          summary: "Read a V2 session's durable events",
          description: "Events after the `after` sequence, oldest first.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("sessionV2.delivery", `${root}/:id/prompt/:messageID/delivery`, {
        params: { id: SessionID, messageID: SessionMessage.ID },
        payload: Schema.Struct({ delivery: SessionDelivery.Delivery }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "sessionV2.delivery",
          summary: "Change a pending V2 prompt's delivery",
          description:
            "`steer` promotes the prompt at the next safe boundary of the running turn, `queue` waits until the session would otherwise go idle.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("sessionV2.interrupt", `${root}/:id/interrupt`, {
        params: { id: SessionID },
        success: HttpApiSchema.NoContent,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "sessionV2.interrupt",
          summary: "Interrupt a running V2 session",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({ title: "sessionV2", description: "V2 session runtime routes (experimental)." }),
    )
