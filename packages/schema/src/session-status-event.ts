export * as SessionStatusEvent from "./session-status-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { NonNegativeInt } from "./schema"
import { SessionID } from "./session-id"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
    /**
     * What the session is doing right now.
     *
     * Optional because `busy` has always been a bare tag: every reader discriminates on `type`
     * alone, and the event is not durable, so there is no stored payload of the old shape.
     * Clients that ignore these fields keep working exactly as before; the TUI used to
     * reverse-engineer all of this from message parts, and every other client got nothing.
     */
    phase: optional(Schema.Literals(["preparing", "thinking", "writing", "tool", "compacting"])),
    /** The tool being run, when `phase` is `tool`. */
    tool: optional(Schema.String),
    /** Which step of the turn this is, counting from 1. */
    step: optional(NonNegativeInt),
    /** When this phase started, so a client can say how long it has been going. */
    since: optional(NonNegativeInt),
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Status = Event.define({
  type: "session.status",
  schema: {
    sessionID: SessionID,
    status: Info,
  },
})

// deprecated
export const Idle = Event.define({
  type: "session.idle",
  schema: {
    sessionID: SessionID,
  },
})

export const Definitions = Event.inventory(Status, Idle)
