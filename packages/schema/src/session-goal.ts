export * as SessionGoal from "./session-goal.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Model } from "./model.js"
import { NonNegativeInt, PositiveInt, optional } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionBudget } from "./session-budget.js"

export const Status = Schema.Literals(["active", "waiting", "paused", "blocked", "done"])
export const Scope = Schema.Literals(["design", "plan", "build"])
export const Input = Schema.Struct({
  objective: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_000)),
  criteria: Schema.Array(Schema.String).pipe(optional),
  gates: Schema.Array(Schema.String).pipe(optional),
  maxTurns: PositiveInt.check(Schema.isLessThanOrEqualTo(1_000)).pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  stopAfter: Scope.pipe(optional),
  executePlan: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "SessionGoal.Input" })
export type Input = typeof Input.Type

export const Evidence = Schema.Struct({
  path: Schema.String,
  hash: Schema.String,
  bytes: NonNegativeInt,
}).annotate({ identifier: "SessionGoal.Evidence" })
export type Evidence = typeof Evidence.Type

export const Info = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  revision: NonNegativeInt,
  objective: Schema.String,
  criteria: Schema.Array(Schema.String),
  gates: Schema.Array(Schema.String),
  stopAfter: Scope,
  executePlan: Schema.Boolean,
  status: Status,
  reason: Schema.String,
  /** Historical field name retained for imported goals; V2 accounts logical Steps. */
  turns: Schema.Struct({ used: NonNegativeInt, max: PositiveInt }),
  tokens: NonNegativeInt,
  reviews: NonNegativeInt,
  evidence: Schema.Array(Evidence),
  checks: Schema.Array(
    Schema.Struct({ command: Schema.String, exitCode: Schema.Number, output: Schema.String, at: Schema.Finite }),
  ),
  budget: SessionBudget.Limits.pipe(optional),
  spendStart: SessionBudget.Totals.pipe(optional),
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "SessionGoal.Info" })
export type Info = typeof Info.Type

export const Control = Schema.Struct({
  action: Schema.Literals(["pause", "resume", "drop", "budget"]),
  maxTurns: PositiveInt.check(Schema.isLessThanOrEqualTo(1_000)).pipe(optional),
  maxCostUsd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))).pipe(optional),
  maxTokens: Schema.NullOr(PositiveInt).pipe(optional),
}).annotate({ identifier: "SessionGoal.Control" })
export type Control = typeof Control.Type

/** What one `/goal` command can ask for; `set` starts a goal and `status` shows the current one. */
export const COMMAND_ACTIONS = ["set", "pause", "resume", "drop", "budget", "status"] as const
export const CommandAction = Schema.Literals(COMMAND_ACTIONS).annotate({ identifier: "SessionGoal.CommandAction" })
export type CommandAction = typeof CommandAction.Type

export interface CommandInput extends Schema.Schema.Type<typeof CommandInput> {}
export const CommandInput = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(16_000)),
}).annotate({ identifier: "SessionGoal.CommandInput" })

/** How the text after `/goal` was read: an action to take, or the interpretations to ask the user about. */
export interface CommandReading extends Schema.Schema.Type<typeof CommandReading> {}
export const CommandReading = Schema.Struct({
  action: CommandAction.pipe(optional),
  options: Schema.Array(CommandAction),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(optional),
}).annotate({ identifier: "SessionGoal.CommandReading" })

export class Error extends Schema.TaggedError<Error>()("SessionGoal.Error", { message: Schema.String }) {}
