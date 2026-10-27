export * as Automation from "./automation.js"

import { Schema } from "effect"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isPattern(/^auto_[\w-]+$/)).pipe(
  Schema.brand("AutomationID"),
  statics((schema) => ({ create: () => schema.make(`auto_${crypto.randomUUID()}`) })),
)
export type ID = typeof ID.Type
export const RunID = Schema.String.check(Schema.isPattern(/^arun_[\w-]+$/)).pipe(
  Schema.brand("AutomationRunID"),
  statics((schema) => ({ create: () => schema.make(`arun_${crypto.randomUUID()}`) })),
)
export type RunID = typeof RunID.Type
const Timestamp = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000_000 }))
export const Schedule = Schema.Union([
  Schema.Struct({ type: Schema.Literal("once"), at: Timestamp }),
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMs: Schema.Int.check(Schema.isBetween({ minimum: 60_000, maximum: 31_536_000_000 })),
  }),
  Schema.Struct({
    type: Schema.Literal("fixed_time"),
    timeOfDay: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    timeZone: Schema.String.annotate({
      description: "Named time zone, validated against the execution host's time-zone database when scheduling.",
    }).check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.isPattern(/^[A-Za-z]/)),
    weekdays: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 }))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(7),
    ),
  }),
]).annotate({ identifier: "Automation.Schedule" })
export type Schedule = typeof Schedule.Type
export const Input = Schema.Struct({
  id: ID,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_000)),
  schedule: Schedule,
}).annotate({ identifier: "Automation.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Info = Schema.Struct({
  ...Input.fields,
  sessionID: SessionID,
  enabled: Schema.Boolean,
  nextAt: Schema.NullOr(Timestamp),
  created: Timestamp,
  updated: Timestamp,
}).annotate({ identifier: "Automation.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Run = Schema.Struct({
  id: RunID,
  automationID: ID,
  inboxID: SessionMessage.ID,
  trigger: Schema.Literals(["scheduled", "manual"]),
  scheduledAt: Timestamp,
  created: Timestamp,
  updated: Timestamp,
  status: Schema.Literals(["pending", "admitted", "failed", "skipped", "missed"]),
  error: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Automation.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}
