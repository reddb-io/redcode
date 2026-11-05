export * as SessionWait from "./session-wait.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { SessionID } from "./session-id.js"
import { optional } from "./schema.js"

/** A process-local operation currently blocking a session. */
export const Info = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["mcp", "model"]),
  started: Schema.Finite,
  target: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.Wait" })
export type Info = typeof Info.Type

export const Changed = Event.ephemeral({
  type: "session.wait.changed",
  schema: { sessionID: SessionID, waits: Schema.Array(Info) },
})
