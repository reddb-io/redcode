export * as SessionObservation from "./session-observation.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"
import { AbsolutePath } from "./schema.js"

/** Receipt and execution metadata; never includes prompts, tools or response content. */
export const Info = Schema.Struct({
  sessionID: Session.ID,
  messageID: SessionMessage.ID,
  directory: AbsolutePath,
  admission: Schema.Literals(["missing", "pending", "delivered"]),
  execution: Schema.Literals(["idle", "running", "suspended"]),
  pending: Schema.Boolean,
  outcome: Session.Info.fields.outcome,
  /** Null when another local runtime owns the in-memory permission/form requests. */
  waiting: Schema.NullOr(Schema.Boolean),
}).annotate({ identifier: "SessionObservation.Info" })
export type Info = typeof Info.Type
