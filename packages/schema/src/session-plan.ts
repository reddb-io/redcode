export * as SessionPlan from "./session-plan"

import { Schema } from "effect"
import { SessionID } from "./session-id"

export const Info = Schema.Struct({
  sessionID: SessionID,
  revision: Schema.String,
  path: Schema.String,
  content: Schema.String,
  status: Schema.Literals(["ready", "approved"]),
  created: Schema.Finite,
}).annotate({ identifier: "SessionPlan.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export class Error extends Schema.TaggedErrorClass<Error>()("SessionPlan.Error", {
  message: Schema.String,
}) {}
