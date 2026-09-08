export * as SessionGoal from "./session-goal"

import { Schema } from "effect"
import { Agent } from "./agent"
import { Model } from "./model"
import { SessionID } from "./session-id"
import { NonNegativeInt, PositiveInt, optional } from "./schema"

export const Status = Schema.Literals(["active", "waiting", "paused", "blocked", "done"])
export const Scope = Schema.Literals(["design", "plan", "build"])
export const Input = Schema.Struct({
  objective: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16000)),
  criteria: Schema.Array(Schema.String).pipe(optional),
  gates: Schema.Array(Schema.String).pipe(optional),
  maxTurns: PositiveInt.check(Schema.isLessThanOrEqualTo(1000)).pipe(optional),
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  stopAfter: Scope.pipe(optional),
  executePlan: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "SessionGoal.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Evidence = Schema.Struct({
  path: Schema.String,
  hash: Schema.String,
  bytes: NonNegativeInt,
}).annotate({ identifier: "SessionGoal.Evidence" })
export interface Evidence extends Schema.Schema.Type<typeof Evidence> {}

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
  turns: Schema.Struct({ used: NonNegativeInt, max: PositiveInt }),
  tokens: NonNegativeInt,
  reviews: NonNegativeInt,
  evidence: Schema.Array(Evidence),
  checks: Schema.Array(
    Schema.Struct({ command: Schema.String, exitCode: Schema.Number, output: Schema.String, at: Schema.Finite }),
  ),
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "SessionGoal.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Control = Schema.Struct({
  action: Schema.Literals(["pause", "resume", "drop", "budget"]),
  maxTurns: PositiveInt.check(Schema.isLessThanOrEqualTo(1000)).pipe(optional),
}).annotate({ identifier: "SessionGoal.Control" })
export interface Control extends Schema.Schema.Type<typeof Control> {}

export class Error extends Schema.TaggedErrorClass<Error>()("SessionGoal.Error", {
  message: Schema.String,
}) {}
