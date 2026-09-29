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
  ])
    .pipe(optional)
    .annotate({ description: "Repeated tool-call limits; false disables the loop guard." }),
  stop_loss: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      every: NonNegativeInt.pipe(optional),
      cooldown: PositiveInt.pipe(optional),
      idle_at: PositiveInt.pipe(optional),
      tokens: PositiveInt.pipe(optional),
      minutes: PositiveInt.pipe(optional),
    }),
  ])
    .pipe(optional)
    .annotate({
      description: "Progress checkpoints across Steps; false disables the stop-loss.",
    }),
  aux_timeout: Schema.Union([Schema.Literal(false), NonNegativeInt])
    .pipe(optional)
    .annotate({
      description: "Deadline in milliseconds for auxiliary model calls; false disables it.",
    }),
  turn_stall: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      warn_ms: PositiveInt.pipe(optional),
      abort_ms: PositiveInt.pipe(optional),
    }),
  ])
    .pipe(optional)
    .annotate({
      description: "Warn when a Step produces no output, and end unattended Steps after a longer silence.",
    }),
  tool_timeout: Schema.Union([Schema.Literal(false), NonNegativeInt])
    .pipe(optional)
    .annotate({
      description:
        "Deadline in milliseconds for a local tool call, excluding time spent waiting for a person; false disables it.",
    }),
  code_mode: Schema.Struct({
    enabled: Schema.Literals(["off", "on"]).pipe(optional).annotate({
      description:
        'Call tools from a confined JavaScript program through the execute tool: "on" enables it. Defaults to "off", which advertises every tool directly.',
    }),
    max_tool_calls: PositiveInt.pipe(optional).annotate({
      description: "Tool calls one program may make before it is stopped. Defaults to 50.",
    }),
    timeout_ms: PositiveInt.pipe(optional).annotate({
      description:
        "Milliseconds one program may run, not counting time spent waiting for a person. Defaults to 120000.",
    }),
    max_output_bytes: PositiveInt.pipe(optional).annotate({
      description: "Bytes of program result and logs kept before the result is cut. Defaults to 1000000.",
    }),
  })
    .pipe(optional)
    .annotate({ description: "Code Mode: tools called from a confined program. Off by default." }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
