export * as Memory from "./memory.js"
import { Schema } from "effect"

/** RSS values include shared pages and must not be summed as unique physical memory. */
export const Entry = Schema.Struct({
  kind: Schema.Literals(["terminal", "agent", "task"]),
  id: Schema.String,
  title: Schema.String,
  pid: Schema.NullOr(Schema.Int),
  residentBytes: Schema.NullOr(Schema.Finite),
  reason: Schema.NullOr(Schema.Literals(["shared", "unavailable", "exited"])),
})
export const Snapshot = Schema.Struct({
  sampledAt: Schema.Finite,
  complete: Schema.Boolean,
  entries: Schema.Array(Entry),
}).annotate({
  identifier: "Memory.Snapshot",
})
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
