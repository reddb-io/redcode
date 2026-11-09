export * as ServerEvent from "./server-event.js"

import { Event } from "./event.js"
import { optional } from "./schema.js"
import { Schema } from "effect"

export const Connected = Event.ephemeral({
  type: "server.connected",
  schema: {
    stream: optional(
      Schema.Struct({
        epoch: Schema.NonEmptyString,
        cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        replayed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        reset: Schema.Boolean,
      }),
    ),
  },
})
export const Disposed = Event.ephemeral({ type: "global.disposed", schema: {} })

export const Definitions = Event.inventory(Connected, Disposed)
