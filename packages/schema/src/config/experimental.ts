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
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
