export * as Intelligence from "./intelligence.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"
import { ConnectionCheck } from "./connection-check.js"
import { Model } from "./model.js"
import { Router } from "./router.js"
import { optional } from "./schema.js"

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

/** `observe` records S1 recommendations while S2 follows the single-reasoning path. */
export const Reasoning = Schema.Literals(["single", "dual", "observe"]).annotate({
  identifier: "Intelligence.Reasoning",
})
export type Reasoning = typeof Reasoning.Type

export const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  reasoning: Reasoning.pipe(optional),
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
    /** Reported USD charge, including an explicitly free response. */
    cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  }),
}).annotate({ identifier: "Intelligence.Response" })
export const Operation = Schema.Literals([
  "context_curation",
  "prompt_classification",
  "response_quality",
  "tool_usage",
  "task_quality",
  "todos",
  "plan",
  "feedback",
  "design_completion",
  "compaction",
  "compact_now",
  "task_completion",
  "goal_completion",
  "subagent_brief",
  "session_progress",
  "subagent_result",
  "design_target",
  "design_system_detect",
  "goal_command",
])
export type Operation = typeof Operation.Type
export const Decision = Schema.Literals(["accepted", "needs_revision", "inconclusive", "unavailable"])
/**
 * The probability at or above which System One establishes a response issue. Below it the issue is
 * unresolved, not found: repairing on it rewrites a sound answer, and the revision reads to the
 * user as the agent replying to itself.
 */
export const REPAIR_CONFIDENCE = 0.75
export const Evaluation = Schema.Struct({
  id: Text,
  fingerprint: Text,
  sessionID: Schema.String,
  operation: Operation,
  kind: Schema.Literals(["classification", "gate"]).pipe(optional),
  subjectID: Schema.String.pipe(optional),
  candidateID: Schema.String.pipe(optional),
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  mode: Reasoning.pipe(optional),
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
  usage: Schema.Struct({
    input_tokens: Schema.Int,
    output_tokens: Schema.Int,
    /** Sum of known USD charges; absent when no charge was reported. */
    cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
    /** Some dispatched work has unknown pricing, even if other batches reported a charge. */
    unpriced: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(optional),
  }),
}).annotate({ identifier: "Intelligence.Evaluation" })
export interface Evaluation extends Schema.Schema.Type<typeof Evaluation> {}
export interface Status extends Schema.Schema.Type<typeof Status> {}
/**
 * A connected RedRouter that serves System One with the saved provider key. `evaluator` is ready to
 * save as the S1 evaluator: it points at the router and shares the provider's credential (its
 * model is the router's recommended System One model when it has one). `recommended` holds the
 * models the router recommends for the accounts the key has connected; model ids are the router's,
 * so a recommendation is the model `id` at provider `providerID`.
 */
export const DetectedRouter = Schema.Struct({
  providerID: Text,
  baseURL: Text,
  detection: Router.Detection,
  evaluator: Evaluator.pipe(optional),
  recommended: Router.Recommendations.pipe(optional),
}).annotate({ identifier: "Intelligence.DetectedRouter" })
export interface DetectedRouter extends Schema.Schema.Type<typeof DetectedRouter> {}
export const EvaluatorOption = Schema.Struct({
  name: Text,
  configured: Schema.Boolean,
  evaluator: Evaluator,
}).annotate({ identifier: "Intelligence.EvaluatorOption" })
export interface EvaluatorOption extends Schema.Schema.Type<typeof EvaluatorOption> {}
export const Status = Schema.Struct({
  settings: Settings,
  environment: Schema.String,
  observations: Schema.Struct({ pending: Schema.Int }).pipe(optional),
  evaluators: Schema.Array(EvaluatorOption),
  effective: Schema.Struct({
    reasoning: Reasoning,
    source: Schema.Literals(["session", "flag", "config", "default"]),
  }),
  router: DetectedRouter.pipe(optional),
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
export const Check = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
  requests: Schema.optional(Schema.Array(ConnectionCheck.Request)),
}).annotate({
  identifier: "Intelligence.Check",
})

export const SessionMode = Schema.Struct({ reasoning: Schema.NullOr(Reasoning) }).annotate({
  identifier: "Intelligence.SessionMode",
})
export type SessionMode = typeof SessionMode.Type

const ArtifactFields = {
  id: Text,
  sessionID: Schema.String,
  subjectID: Text,
  policy: Text,
  created: Schema.Finite,
}
export const Curation = Schema.Struct({
  ...ArtifactFields,
  type: Schema.Literal("curation"),
  omitted: Schema.Array(Schema.Struct({ messageID: Text, hash: Text, evaluationID: Text })),
}).annotate({ identifier: "Intelligence.Curation" })
export type Curation = typeof Curation.Type
export const LearningCandidate = Schema.Struct({
  ...ArtifactFields,
  type: Schema.Literal("learning"),
  status: Schema.Literals(["proposed", "approved", "rejected"]),
  evaluations: Schema.Array(Text).check(Schema.isMinLength(2)),
  proposal: Text,
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Intelligence.LearningCandidate" })
export type LearningCandidate = typeof LearningCandidate.Type
export const Artifact = Schema.Union([Curation, LearningCandidate]).annotate({ identifier: "Intelligence.Artifact" })
export type Artifact = typeof Artifact.Type
export const LearningReview = Schema.Struct({
  status: Schema.Literals(["approved", "rejected"]),
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Intelligence.LearningReview" })
export type LearningReview = typeof LearningReview.Type
