export * as Intelligence from "./intelligence"

import { Schema } from "effect"
import { Credential } from "./credential"
import { Model } from "./model"
import { optional } from "./schema"

const Text = Schema.String.check(Schema.isMinLength(1))
const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
export const Evaluator = Schema.Struct({
  transport: Schema.Literals([
    "opencode-zen",
    "openrouter",
    "typesafe",
    "red-router",
    "cloudflare-ai-gateway",
    "vercel",
    "vivgrid",
    "nano-gpt",
  ]),
  baseURL: Text,
  model: Text,
  credentialID: Credential.ID.pipe(optional),
}).annotate({ identifier: "Intelligence.Evaluator" })
export interface Evaluator extends Schema.Schema.Type<typeof Evaluator> {}

export const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  onboarding: Schema.Literals(["pending", "deferred", "completed"]),
  principal: Model.Ref.pipe(optional),
  fast: Model.Ref.pipe(optional),
  evaluator: Evaluator.pipe(optional),
}).annotate({ identifier: "Intelligence.Settings" })
export interface Settings extends Schema.Schema.Type<typeof Settings> {}
export interface Save extends Schema.Schema.Type<typeof Save> {}
export const Save = Schema.Struct({ settings: Settings, apiKey: Text.pipe(optional) }).annotate({
  identifier: "Intelligence.Save",
})
export const Question = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("noul"),
    instructions: Schema.Json,
    criteria: Schema.Struct({ true: Schema.Json, false: Schema.Json }).pipe(optional),
  }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.Json,
    criteria: Schema.Record(Schema.String, Schema.Json),
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: Schema.Json,
    criteria: Schema.Array(Schema.Json).check(Schema.isMinLength(2), Schema.isMaxLength(10)),
  }),
]).annotate({ identifier: "Intelligence.Question" })
export type Question = typeof Question.Type
export const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Probability }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Text,
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Finite,
    legend: Schema.Record(Schema.String, Schema.Json),
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
]).annotate({ identifier: "Intelligence.Answer" })
export type Answer = typeof Answer.Type
export interface Response extends Schema.Schema.Type<typeof Response> {}
export const Response = Schema.Struct({
  model: Text,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.Struct({
    input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
}).annotate({ identifier: "Intelligence.Response" })
export const Operation = Schema.Literals([
  "prompt_classification",
  "response_quality",
  "task_quality",
  "todos",
  "plan",
  "feedback",
  "design_completion",
  "compaction",
  "compact_now",
  "task_completion",
])
export type Operation = typeof Operation.Type
export const Decision = Schema.Literals(["accepted", "needs_revision", "inconclusive", "unavailable"])
export const Evaluation = Schema.Struct({
  id: Text,
  fingerprint: Text,
  sessionID: Schema.String,
  operation: Operation,
  kind: Schema.Literals(["classification", "gate"]).pipe(optional),
  subjectID: Schema.String.pipe(optional),
  candidateID: Schema.String.pipe(optional),
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  policy: Schema.String,
  decision: Decision,
  model: Schema.String,
  answers: Schema.Record(Schema.String, Answer),
  issues: Schema.Array(Schema.String),
  created: Schema.Finite,
  duration: Schema.Finite,
  evaluator: Schema.Struct({
    transport: Evaluator.fields.transport,
    baseURL: Text,
    model: Text,
  }).pipe(optional),
  usage: Schema.Struct({ input_tokens: Schema.Int, output_tokens: Schema.Int }),
}).annotate({ identifier: "Intelligence.Evaluation" })
export interface Evaluation extends Schema.Schema.Type<typeof Evaluation> {}
export interface Status extends Schema.Schema.Type<typeof Status> {}
export const EvaluatorOption = Schema.Struct({
  name: Text,
  configured: Schema.Boolean,
  evaluator: Evaluator,
}).annotate({ identifier: "Intelligence.EvaluatorOption" })
export interface EvaluatorOption extends Schema.Schema.Type<typeof EvaluatorOption> {}
export const Status = Schema.Struct({
  settings: Settings,
  environment: Schema.String,
  evaluators: Schema.Array(EvaluatorOption),
}).annotate({
  identifier: "Intelligence.Status",
})
export interface Models extends Schema.Schema.Type<typeof Models> {}
export const Models = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Text, name: Text })),
  manual: Schema.Boolean,
}).annotate({ identifier: "Intelligence.Models" })
export interface Probe extends Schema.Schema.Type<typeof Probe> {}
export const Probe = Schema.Struct({ evaluator: Evaluator, apiKey: Text.pipe(optional) }).annotate({
  identifier: "Intelligence.Probe",
})
export interface Check extends Schema.Schema.Type<typeof Check> {}
export const Check = Schema.Struct({ ok: Schema.Boolean, message: Schema.String }).annotate({
  identifier: "Intelligence.Check",
})
