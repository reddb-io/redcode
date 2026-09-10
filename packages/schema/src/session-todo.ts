export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { optional, PositiveInt } from "./schema"

export const Status = Schema.Literals(["pending", "in_progress", "blocked", "completed", "cancelled"])
export const Priority = Schema.Literals(["high", "medium", "low"])

const tracking = {
  id: optional(Schema.String),
  revision: optional(PositiveInt),
  reason: optional(Schema.String),
}

export const Input = Schema.Struct({
  ...tracking,
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
