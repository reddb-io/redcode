export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  loop_guard: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      correct_at: PositiveInt.pipe(optional),
      stop_at: PositiveInt.pipe(optional),
      nudge_at: PositiveInt.pipe(optional),
    }),
  ]).pipe(optional).annotate({ description: "Repeated tool-call limits; false disables the loop guard." }),
  aux_timeout: Schema.Union([Schema.Literal(false), NonNegativeInt]).pipe(optional).annotate({
    description: "Deadline in milliseconds for auxiliary model calls; false disables it.",
  }),
  turn_stall: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      warn_ms: PositiveInt.pipe(optional),
      abort_ms: PositiveInt.pipe(optional),
    }),
  ]).pipe(optional).annotate({
    description: "Warn when a Step produces no output, and end unattended Steps after a longer silence.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
