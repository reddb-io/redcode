export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { optional, PositiveInt } from "./schema"

export const Status = Schema.Literals(["pending", "in_progress", "blocked", "completed", "cancelled"])
export const Priority = Schema.Literals(["high", "medium", "low"])

export const Source = Schema.Struct({
  type: Schema.Literals(["request", "plan"]),
  id: Schema.String,
  quote: Schema.String,
  created: Schema.Finite,
  key: optional(Schema.String),
}).annotate({ identifier: "Todo.Source" })
export type Source = typeof Source.Type

export const EvidenceInput = Schema.Struct({
  callID: Schema.String,
  messageID: optional(Schema.String),
  explanation: Schema.String.check(Schema.isMinLength(1)),
})
export const Evidence = Schema.Struct({
  ...EvidenceInput.fields,
  messageID: Schema.String,
  tool: Schema.String,
  hash: Schema.String,
  observed: Schema.Finite,
}).annotate({ identifier: "Todo.Evidence" })
export type Evidence = typeof Evidence.Type

export const PlanTask = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1)),
  content: Schema.String.check(Schema.isMinLength(1)),
  criterion: Schema.String.check(Schema.isMinLength(1)),
  quote: Schema.String.check(Schema.isMinLength(1)),
}).annotate({ identifier: "Todo.PlanTask" })
export type PlanTask = typeof PlanTask.Type

const tracking = {
  id: optional(Schema.String),
  revision: optional(PositiveInt),
  reason: optional(Schema.String),
}

export const Input = Schema.Struct({
  ...tracking,
  planKey: optional(Schema.String),
  requirement: optional(
    Schema.String.annotate({ description: "Exact quote from the user request covered by this task" }),
  ),
  criterion: optional(Schema.String.annotate({ description: "Observable acceptance condition for this task" })),
  evidence: optional(EvidenceInput),
  scopeChange: optional(Schema.Struct({ messageID: Schema.String, quote: Schema.String })),
  content: Schema.String.check(Schema.isMinLength(1)),
  status: Status,
  priority: Priority,
}).annotate({ identifier: "Todo.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Info = Schema.Struct({
  // Old tool results and event snapshots predate task identity and closed states.
  // Keep the read contract compatible; all new writes pass through Input.
  ...tracking,
  legacyStatus: optional(Schema.String),
  source: optional(Source),
  criterion: optional(Schema.String),
  evidence: optional(Evidence),
  scopeChange: optional(
    Schema.Struct({ messageID: Schema.String, quote: Schema.String, created: optional(Schema.Finite) }),
  ),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "pending, in_progress, blocked, completed, cancelled; historical snapshots may contain other values",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export class Error extends Schema.TaggedErrorClass<Error>()("SessionTodo.Error", { message: Schema.String }) {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
