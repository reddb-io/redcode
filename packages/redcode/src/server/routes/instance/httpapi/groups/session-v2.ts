import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Prompt } from "@reddb-io/redcode-schema/prompt"
import { Admitted, Delivery } from "@reddb-io/redcode-schema/session-input"
import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { SessionDelivery } from "@reddb-io/redcode-schema/session-delivery"
import { SessionID } from "@reddb-io/redcode-schema/session-id"
import { SessionEvent } from "@reddb-io/redcode-schema/session-event"
import { Session } from "@reddb-io/redcode-schema/session"
import { ConflictError, SessionNotFoundError } from "../errors"
import { described } from "./metadata"

const root = "/experimental/session-v2"

export const SessionPromptPayload = Schema.Struct({
  sessionID: SessionID,
  prompt: Prompt,
  id: SessionMessage.ID.pipe(Schema.optional),
  delivery: Delivery.pipe(Schema.optional),
  resume: Schema.optional(Schema.Boolean),
})

export const SessionEventsQuery = Schema.Struct({
  after: Schema.optional(Schema.NumberFromString),
})

export const SessionV2Api = HttpApi.make("sessionV2").add(
  HttpApiGroup.make("sessionV2")
    .add(
      HttpApiEndpoint.post("prompt", `${root}/prompt`, {
        payload: SessionPromptPayload,
        success: described(Admitted, "The durable prompt admission"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.sessionV2.prompt",
          summary: "Prompt a session through the V2 runtime",
          description:
            "Admits one durable prompt row and schedules the V2 session drain. The prompt becomes a user message at a safe boundary.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("session", `${root}/:id`, {
        params: { id: SessionID },
        success: described(Session.Info, "The session"),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.sessionV2.session",
          summary: "Read a V2 session",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("messages", `${root}/:id/messages`, {
        params: { id: SessionID },
        success: described(Schema.Array(SessionMessage.Message), "The session's messages"),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.sessionV2.messages",
          summary: "Read a V2 session's messages",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("events", `${root}/:id/events`, {
        params: { id: SessionID },
        query: SessionEventsQuery,
        success: described(Schema.Array(SessionEvent.Durable), "The session's durable events"),
        error: SessionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.sessionV2.events",
          summary: "Read a V2 session's durable events",
          description: "Events after the `after` sequence, oldest first.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("interrupt", `${root}/:id/interrupt`, {
        params: { id: SessionID },
        success: described(HttpApiSchema.NoContent, "Interrupted"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.sessionV2.interrupt",
          summary: "Interrupt a running V2 session",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "sessionV2", description: "Experimental V2 session routes." })),
)
