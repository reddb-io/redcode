export * as SubagentReview from "./subagent-review.js"

import { Option, Schema } from "effect"
import { optional } from "./schema.js"

/**
 * The child session metadata key holding the brief a subagent was launched under, how its parent
 * judged the brief and the latest result, and the stop-loss checkpoints that acted on it. The
 * parent's subagent tool keeps it there so surfaces show a subagent without loading its messages.
 */
export const METADATA_KEY = "subagentBrief"

/** The session message metadata key a stop-loss notice keeps its checkpoint under. */
export const STOP_LOSS_KEY = "stopLoss"

/** Checkpoints kept in the metadata; older ones stay in the transcript. */
export const CHECKPOINT_LIMIT = 20

/** How the brief was judged before the subagent started; `skipped` when nobody reviewed it. */
export const BriefVerdict = Schema.Literals([
  "verified",
  "inconclusive",
  "needs_revision",
  "unverified",
  "skipped",
]).annotate({ identifier: "SubagentReview.BriefVerdict" })
export type BriefVerdict = typeof BriefVerdict.Type

/** How a subagent's result was judged against its brief before it reached the parent. */
export const Decision = Schema.Literals(["verified", "inconclusive", "needs_revision", "unverified"]).annotate({
  identifier: "SubagentReview.Decision",
})
export type Decision = typeof Decision.Type

export const Result = Schema.Struct({
  decision: Decision,
  /** S1's issue ids and the ids of blocking mechanical findings, without repeats. */
  issues: Schema.Array(Schema.String),
  /** Whether the subagent had its one repair round before this verdict. */
  repaired: Schema.Boolean,
  evaluationID: Schema.String.pipe(optional),
  /** Why S1 gave no verdict, when it could not be reached. */
  unavailable: Schema.String.pipe(optional),
  at: Schema.Finite,
}).annotate({ identifier: "SubagentReview.Result" })
export type Result = typeof Result.Type

export const CheckpointAction = Schema.Literals(["steer", "ask_user", "stop"]).annotate({
  identifier: "SubagentReview.CheckpointAction",
})
export type CheckpointAction = typeof CheckpointAction.Type

/** A stop-loss checkpoint that acted: the line surfaces show, such as `S1 · no progress for 9 steps`. */
export const Checkpoint = Schema.Struct({
  action: CheckpointAction,
  line: Schema.String,
  at: Schema.Finite,
}).annotate({ identifier: "SubagentReview.Checkpoint" })
export type Checkpoint = typeof Checkpoint.Type

export const Brief = Schema.Struct({
  prompt: Schema.String,
  agent: Schema.String,
  scope: Schema.Array(Schema.String),
  criteria: Schema.Array(Schema.String),
  returnFormat: Schema.String.pipe(optional),
  /** Whether the subagent may change files or run commands. */
  writeCapable: Schema.Boolean,
  parentSessionID: Schema.String,
  verdict: BriefVerdict,
  issues: Schema.Array(Schema.String),
  evaluationID: Schema.String.pipe(optional),
  created: Schema.Finite,
  result: Result.pipe(optional),
  checkpoints: Schema.Array(Checkpoint).pipe(optional),
}).annotate({ identifier: "SubagentReview.Brief" })
export type Brief = typeof Brief.Type
export type Stored = typeof Brief.Encoded

const decodeBrief = Schema.decodeUnknownOption(Brief)
const encodeBrief = Schema.encodeSync(Brief)
const decodeNotice = Schema.decodeUnknownOption(Schema.Struct({ action: CheckpointAction, line: Schema.String }))
const decodeReview = Schema.decodeUnknownOption(Schema.Struct({ decision: Decision }))

/** The one-character badge each verdict is shown with. */
export const SYMBOL: Record<Decision, string> = {
  verified: "✓",
  inconclusive: "?",
  needs_revision: "!",
  unverified: "~",
}

export const LABEL: Record<Decision, string> = {
  verified: "verified",
  inconclusive: "inconclusive",
  needs_revision: "needs revision",
  unverified: "unverified",
}

/** The brief kept on a session's metadata; undefined when there is none or it is malformed. */
export function read(metadata: Readonly<Record<string, unknown>> | undefined): Brief | undefined {
  return Option.getOrUndefined(decodeBrief(metadata?.[METADATA_KEY]))
}

/** The session metadata with `brief` recorded, keeping every other key. */
export function write<V>(metadata: Readonly<Record<string, V>> | undefined, brief: Brief): Record<string, V | Stored> {
  return { ...metadata, [METADATA_KEY]: encodeBrief(brief) }
}

/**
 * Whether the parent reviews the subagent's result against its brief: the parent wrote the brief
 * and gave it structure to check against.
 */
export function supervised(brief: Brief | undefined): brief is Brief {
  return (
    brief !== undefined &&
    brief.verdict !== "skipped" &&
    (brief.scope.length > 0 || brief.criteria.length > 0 || Boolean(brief.returnFormat?.trim()))
  )
}

/** The checkpoint a stop-loss notice on a message carries; undefined for any other message. */
export function checkpoint(
  message: { readonly metadata?: Readonly<Record<string, unknown>> },
  at: number,
): Checkpoint | undefined {
  return Option.getOrUndefined(
    Option.map(decodeNotice(message.metadata?.[STOP_LOSS_KEY]), (notice) => ({ ...notice, at })),
  )
}

export type CheckpointState =
  | { readonly type: "in_scope" }
  | { readonly type: "corrected"; readonly line: string }
  | { readonly type: "stopped"; readonly line: string }

/** Where the latest checkpoint left the subagent: nothing acted, a hint was sent, or it was stopped. */
export function checkpointState(list: ReadonlyArray<Checkpoint>): CheckpointState {
  const last = list.at(-1)
  if (!last) return { type: "in_scope" }
  if (last.action === "steer") return { type: "corrected", line: last.line }
  return { type: "stopped", line: last.line }
}

/**
 * The verdict on a subagent's latest result: the one its task call returned, else the one kept in
 * the child's brief, since a background task reports after its tool call has returned.
 */
export function decision(
  task: Readonly<Record<string, unknown>> | undefined,
  child: Readonly<Record<string, unknown>> | undefined,
): Decision | undefined {
  return Option.getOrUndefined(decodeReview(task?.review))?.decision ?? read(child)?.result?.decision
}
