export * as SessionGuard from "./session-guard.js"

import { Schema } from "effect"
import { SessionID } from "./session-id.js"

export const Guard = Schema.Literals([
  "stall",
  "tool_timeout",
  "loop",
  "steps",
  "aux",
  "orphan",
  "goal",
  "compaction",
  "budget",
  "intelligence",
  "stop_loss",
])
export type Guard = typeof Guard.Type

export const Action = Schema.Literals(["warn", "correct", "stop"])
export type Action = typeof Action.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  guard: Guard,
  action: Action,
  subject: Schema.String.pipe(Schema.optional),
  detail: Schema.String,
  at: Schema.Number,
})
export type Entry = typeof Entry.Type

export const Summary = Schema.Struct({ guard: Guard, action: Action, count: Schema.Number })
export type Summary = typeof Summary.Type

export const Report = Schema.Struct({ summary: Schema.Array(Summary), recent: Schema.Array(Entry) })
export type Report = typeof Report.Type
