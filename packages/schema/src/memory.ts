export * as Memory from "./memory.js"
import { Schema } from "effect"
import { optional, PositiveInt } from "./schema.js"

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

export const CaptureID = Schema.String.check(Schema.isPattern(/^cap_[0-9a-f-]{36}$/)).pipe(
  Schema.brand("Memory.CaptureID"),
)
export type CaptureID = typeof CaptureID.Type

export const CaptureState = Schema.Literals(["pending", "running", "completed", "failed", "cancelled"])
export type CaptureState = typeof CaptureState.Type

export const CaptureKind = Schema.Literals(["heap", "cpu", "samples"])
export type CaptureKind = typeof CaptureKind.Type

export const CaptureTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("server") }),
  Schema.Struct({
    kind: Schema.Literal("process"),
    pid: PositiveInt,
    label: optional(Schema.String.check(Schema.isMaxLength(200))),
  }),
])
export type CaptureTarget = typeof CaptureTarget.Type

export const Capture = Schema.Struct({
  id: CaptureID,
  kind: CaptureKind,
  target: CaptureTarget,
  state: CaptureState,
  createdAt: Schema.Finite,
  startedAt: optional(Schema.Finite),
  completedAt: optional(Schema.Finite),
  expiresAt: Schema.Finite,
  size: optional(Schema.Finite),
  error: optional(Schema.String.check(Schema.isMaxLength(2_048))),
  filename: optional(Schema.String.check(Schema.isMaxLength(255))),
})
export interface Capture extends Schema.Schema.Type<typeof Capture> {}

export const CaptureStart = Schema.Struct({
  kind: CaptureKind,
  target: CaptureTarget,
  durationMs: optional(Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 60_000 }))),
  retentionMs: optional(Schema.Int.check(Schema.isBetween({ minimum: 60_000, maximum: 86_400_000 }))),
})
export interface CaptureStart extends Schema.Schema.Type<typeof CaptureStart> {}
