export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"
import { PositiveInt } from "../schema"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

// The guard keys share their names and meaning with the legacy config, so one redcode.json
// configures both runtimes.
export const LoopGuard = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    correct_at: PositiveInt.pipe(Schema.optional),
    stop_at: PositiveInt.pipe(Schema.optional),
    nudge_at: PositiveInt.pipe(Schema.optional),
  }),
]).annotate({
  description:
    "How many identical tool calls in a row - same arguments, same result - before the model is told it is repeating itself (correct_at, default 3) and before the turn ends (stop_at, default 5). nudge_at (default 12) says how many identical calls are allowed before it is mentioned even when the answers keep differing. Set to false to disable.",
})

export const ToolTimeout = Schema.Union([Schema.Literal(false), PositiveInt]).annotate({
  description:
    "Milliseconds a tool may run before it is stopped and reported to the model as a failure (default: 600000). Tools that carry their own deadline, wait for a person, or run a whole child turn are not affected. Set to false to disable.",
})

export const TurnStall = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    warn_ms: PositiveInt.pipe(Schema.optional).annotate({
      description: "Say the turn has gone quiet after this long (default: 300000)",
    }),
    abort_ms: PositiveInt.pipe(Schema.optional).annotate({
      description: "End a turn that has produced nothing for this long (default: 600000)",
    }),
  }),
]).annotate({
  description:
    "How long a turn may produce nothing before it is reported and, where nothing is watching, ended. Time a tool spends running or a permission spends awaiting an answer does not count. Set to false to disable.",
})

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  loop_guard: LoopGuard.pipe(Schema.optional),
  tool_timeout: ToolTimeout.pipe(Schema.optional),
  turn_stall: TurnStall.pipe(Schema.optional),
}) {}
