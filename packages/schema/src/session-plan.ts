export * as SessionPlan from "./session-plan.js"

import { Schema } from "effect"
import { SessionTodo } from "./session-todo.js"
import { SessionID } from "./session-id.js"
import { optional } from "./schema.js"

export const Info = Schema.Struct({
  sessionID: SessionID,
  revision: Schema.String,
  path: Schema.String,
  content: Schema.String,
  tasks: optional(Schema.Array(SessionTodo.PlanTask)),
  status: Schema.Literals(["ready", "approved"]),
  created: Schema.Finite,
}).annotate({ identifier: "SessionPlan.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export class Error extends Schema.TaggedError<Error>()("SessionPlan.Error", {
  message: Schema.String,
}) {}
