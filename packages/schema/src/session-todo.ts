export * as SessionTodo from "./session-todo.js"

import { Schema, SchemaGetter } from "effect"
import { SubagentReview } from "./subagent-review.js"
import { ephemeral, inventory } from "./event.js"
import { SessionID } from "./session-id.js"
import { AbsolutePath, optional, PositiveInt, NonNegativeInt } from "./schema.js"
import { Worktree } from "./worktree.js"

export const Status = Schema.Literals(["pending", "in_progress", "blocked", "completed", "cancelled"])
export const Priority = Schema.Literals(["high", "medium", "low"])
export const Phase = Schema.Literals(["build", "design", "plan"])

export function phase(agent: string): typeof Phase.Type {
  return agent === "design" ? "design" : agent === "plan" ? "plan" : "build"
}

export function forAgent<T extends { readonly phase?: typeof Phase.Type }>(tasks: readonly T[], agent: string) {
  return tasks.filter(
    (task) => (task.phase ?? "build") === phase(agent) || (agent === "plan" && task.phase === "design"),
  )
}

/** The most graphemes a task label keeps before it is cut with an ellipsis. */
export const TITLE_LIMIT = 80

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * The short label a task list shows: the model's title, or, for a task without one, the first line of
 * its content, cut at the first sentence end when the line is too long. Deterministic and cut on
 * grapheme boundaries, so accents, CJK and emoji stay whole; surfaces still fit it to their width.
 */
export function label(task: { readonly title?: string | undefined; readonly content: string }) {
  const line = ((task.title?.trim() || task.content).split(/\r?\n/).find((entry) => entry.trim()) ?? "")
    .replace(/\s+/gu, " ")
    .trim()
  const parts = Array.from(graphemes.segment(line), (entry) => entry.segment)
  if (parts.length <= TITLE_LIMIT) return line
  // A Latin sentence end must be followed by a space, so file names such as todo.ts are not taken for
  // one; full-width CJK stops end a sentence on their own.
  const sentence = /^.+?(?:[.!?](?= )|[。！？])/u.exec(line)?.[0]
  if (sentence && Array.from(graphemes.segment(sentence)).length <= TITLE_LIMIT) return sentence
  return `${parts
    .slice(0, TITLE_LIMIT - 1)
    .join("")
    .trimEnd()}…`
}

export const Source = Schema.Struct({
  type: Schema.Literals(["request", "plan"]),
  id: Schema.String,
  quote: Schema.String,
  created: Schema.Finite,
  key: optional(Schema.String),
  /**
   * The model's requirement when it quoted no request and the latest request was attached instead.
   * Kept as the task's criterion, it restates the request, so it never explains a check.
   */
  paraphrase: optional(Schema.String),
}).annotate({ identifier: "Todo.Source" })
export type Source = typeof Source.Type

// Nothing inside the evidence is required by the schema: a model that cites a result without saying how
// it meets the task is answered by the store with the exact update to resend (see NEEDS_EXPLANATION),
// and one that explains without citing a result gets the newest verification selected for it. Either
// answer is more useful than a schema refusal, and neither loosens the completion gate.
export const EvidenceInput = Schema.Struct({
  callID: optional(
    Schema.String.annotate({
      description: "callID of the successful tool result that proves the task; when omitted, one is selected",
    }),
  ),
  messageID: optional(Schema.String.annotate({ description: "The message of that result, when its callID is reused" })),
  explanation: optional(Schema.String.annotate({ description: "How that result meets the task's criterion" })),
})
export const Evidence = Schema.Struct({
  ...EvidenceInput.fields,
  callID: Schema.String,
  messageID: Schema.String,
  explanation: Schema.String,
  tool: Schema.String,
  hash: Schema.String,
  observed: Schema.Finite,
}).annotate({ identifier: "Todo.Evidence" })
export type Evidence = typeof Evidence.Type

export const PlanTask = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1)),
  title: optional(
    Schema.String.annotate({
      description: `Short one-line label for the task list, at most ${TITLE_LIMIT} characters; content keeps the full task`,
    }),
  ),
  content: Schema.String.check(Schema.isMinLength(1)),
  criterion: Schema.String.check(Schema.isMinLength(1)),
  quote: Schema.String.check(Schema.isMinLength(1)),
  dependencies: optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
}).annotate({ identifier: "Todo.PlanTask" })
export type PlanTask = typeof PlanTask.Type

const tracking = {
  id: optional(Schema.String),
  revision: optional(
    PositiveInt.annotate({
      description:
        "The revision you were shown for this task; omit it from an update to apply against the stored revision, and a supplied revision that no longer matches is refused",
    }),
  ),
  reason: optional(Schema.String),
  // The task list shows the title and the model reads content, so a long task stays readable in a
  // narrow panel without losing its definition of done.
  title: optional(
    Schema.String.annotate({
      description: `Short one-line label shown in the task list: imperative, at most ${TITLE_LIMIT} characters. Put the full task and its acceptance detail in content`,
    }),
  ),
}

export const Input = Schema.Struct({
  ...tracking,
  dependencies: optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).annotate({
      description:
        "Task IDs that must be completed with current evidence before this task starts or completes. An empty array clears dependencies; omission preserves them.",
    }),
  ),
  planKey: optional(Schema.String),
  requirement: optional(
    Schema.String.annotate({
      description:
        "Quote from the user request covered by this task; a paraphrase or translation is kept as the criterion and linked to the latest request",
    }),
  ),
  criterion: optional(Schema.String.annotate({ description: "Observable acceptance condition for this task" })),
  evidence: optional(
    EvidenceInput.annotate({
      description:
        "Successful tool result proving completion, with an explanation. When omitted, only a verification result (successful bash or shell check, design_preview or design_export) newer than the last edit is selected",
    }),
  ),
  // The description asks for both, but a model that does not know the message id, or that only has the
  // instruction's words, is linked to the latest request rather than refused; the reason is what a
  // cancellation cannot do without, and the store checks that.
  scopeChange: optional(
    Schema.Struct({
      messageID: optional(Schema.String.annotate({ description: "ID of the user message that removed this work" })),
      quote: optional(Schema.String.annotate({ description: "The instruction removing the requirement" })),
    }).annotate({
      description:
        "The user message that removed this work; a quote that matches no message is linked to the latest request",
    }),
  ),
  // Content and priority are required to create a task; an update addressed by id keeps the stored values.
  content: optional(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "The full task, with the detail needed to do and verify it; required when creating, optional when updating by id",
    }),
  ),
  // Nothing is required of one item: an update names only its id, revision and the fields that change,
  // so a status that did not change may be left out and the stored one stays. A new task without a
  // status starts pending.
  status: optional(
    Status.annotate({
      description: "pending when creating without one; stays as stored when omitted from an update by id",
    }),
  ),
  priority: optional(Priority.annotate({ description: "Required when creating, optional when updating by id" })),
}).annotate({ identifier: "Todo.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

// Models routinely name the description text, title or task. Accept those spellings at the tool
// boundary and fold them into content before the canonical Input is validated. Content is the first
// non-blank of content, text, title and task, exactly as before titles existed; a title is kept as the
// short label only when content or text supplied the content, so {"title":"X"} is still a task X.
export const ModelInput = Schema.Struct({
  ...Input.fields,
  // Empty content is checked after folding, so {"content":"","title":"X"} still becomes X.
  content: optional(Schema.String),
  text: optional(Schema.String),
  task: optional(Schema.String),
}).pipe(
  Schema.decodeTo(Input, {
    decode: SchemaGetter.transform(({ text, title, task, ...item }) => {
      const content = [item.content, text, title, task].find((value) => value?.trim()) ?? item.content
      const labelled = title?.trim() && (item.content?.trim() || text?.trim()) ? { title } : {}
      return content === undefined ? item : { ...item, ...labelled, content }
    }),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)

export const IntegrationSource = Schema.Struct({
  taskID: Schema.String,
  taskRevision: PositiveInt,
  fingerprint: Schema.String,
  sessionID: SessionID,
  promptID: Schema.String,
  sessionDirectory: AbsolutePath,
  directory: AbsolutePath,
  head: Worktree.PrepareIntegrationInput.fields.targetHead,
}).annotate({ identifier: "Todo.IntegrationSource" })
export interface IntegrationSource extends Schema.Schema.Type<typeof IntegrationSource> {}

/** Host-observed provenance. A candidate binding is never a validation or acceptance receipt. */
export const Integration = Schema.Struct({
  fingerprint: Schema.String,
  preparedAt: Schema.Finite,
  target: AbsolutePath,
  targetHead: Worktree.PrepareIntegrationInput.fields.targetHead,
  head: Worktree.PrepareIntegrationInput.fields.targetHead,
  tree: Worktree.PrepareIntegrationInput.fields.targetHead,
  sources: Schema.Array(IntegrationSource).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
}).annotate({ identifier: "Todo.Integration" })
export interface Integration extends Schema.Schema.Type<typeof Integration> {}

/** Observed by the executor around a foreground check of an unchanged, clean candidate checkout. */
export const IntegrationVerification = Schema.Struct({
  sessionID: SessionID,
  taskID: Schema.String,
  fingerprint: Schema.String,
  head: Integration.fields.head,
  tree: Integration.fields.tree,
  directory: AbsolutePath,
  command: Schema.String,
  started: Schema.Finite,
  completed: Schema.Finite,
}).annotate({ identifier: "Todo.IntegrationVerification" })
export interface IntegrationVerification extends Schema.Schema.Type<typeof IntegrationVerification> {}

export const PrepareIntegrationInput = Schema.Struct({
  revision: PositiveInt,
  target: AbsolutePath,
  targetHead: Worktree.PrepareIntegrationInput.fields.targetHead,
}).annotate({ identifier: "Todo.PrepareIntegrationInput" })
export interface PrepareIntegrationInput extends Schema.Schema.Type<typeof PrepareIntegrationInput> {}

export const Info = Schema.Struct({
  // Old tool results and event snapshots predate task identity and closed states.
  // Keep the read contract compatible; all new writes pass through Input.
  ...tracking,
  phase: optional(Phase),
  legacyStatus: optional(Schema.String),
  source: optional(Source),
  criterion: optional(Schema.String),
  evidence: optional(Evidence),
  dependencies: optional(Schema.Array(Schema.String)),
  inputs: optional(Schema.Array(Schema.Struct({ id: Schema.String, hash: Schema.String }))),
  integration: optional(Integration),
  scopeChange: optional(
    Schema.Struct({
      messageID: Schema.String,
      quote: Schema.String,
      created: optional(Schema.Finite),
      /** The model's words when they quoted no user message and the latest request was attached instead. */
      paraphrase: optional(Schema.String),
    }),
  ),
  content: Schema.String.annotate({ description: "The full task the model works from" }),
  status: Schema.String.annotate({
    description: "pending, in_progress, blocked, completed, cancelled; historical snapshots may contain other values",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
  // When the task closed (completed or cancelled), so a live panel can keep closed tasks only
  // while they are fresh and let the older ones fall away.
  closedAt: optional(Schema.Finite),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const IntegrationPreparation = Schema.Struct({
  task: Info,
  candidate: Worktree.IntegrationCandidate,
}).annotate({ identifier: "Todo.IntegrationPreparation" })
export interface IntegrationPreparation extends Schema.Schema.Type<typeof IntegrationPreparation> {}

/** Observations from one delegated execution; summaries are data, never acceptance evidence. */
export const Contribution = Schema.Struct({
  sessionID: SessionID,
  taskRevision: PositiveInt,
  promptID: Schema.String,
  fingerprint: Schema.String,
  current: Schema.Boolean,
  execution: Schema.Literals(["running", "succeeded", "failed", "interrupted", "unknown"]),
  review: optional(SubagentReview.Result),
  completion: optional(SubagentReview.Completion),
  response: optional(
    Schema.Struct({
      messageID: Schema.String,
      text: Schema.String,
      hash: Schema.String,
      bytes: NonNegativeInt,
      truncated: Schema.Boolean,
    }),
  ),
  checks: Schema.Array(
    Schema.Struct({
      callID: Schema.String,
      messageID: Schema.String,
      tool: Schema.String,
      hash: Schema.String,
      completed: Schema.Finite,
      successful: Schema.Boolean,
      settled: Schema.Boolean,
      fresh: Schema.Boolean,
      invalidatedBy: optional(
        Schema.Struct({ sessionID: optional(SessionID), messageID: Schema.String, callID: Schema.String }),
      ),
    }),
  ),
  omittedChecks: NonNegativeInt,
  changedPaths: Schema.Array(Schema.String),
  omittedPaths: NonNegativeInt,
  unknownWriteScope: Schema.Boolean,
}).annotate({ identifier: "Todo.Contribution" })
export interface Contribution extends Schema.Schema.Type<typeof Contribution> {}

export const ReconciliationInput = Schema.Struct({
  task: Info,
  acceptance: Schema.Literals(["accepted", "pending", "blocked", "cancelled", "stale", "unverified"]),
  contributions: Schema.Array(Contribution),
  issues: Schema.Array(Schema.String),
}).annotate({ identifier: "Todo.ReconciliationInput" })
export interface ReconciliationInput extends Schema.Schema.Type<typeof ReconciliationInput> {}

/** A derived read model for one task and its required inputs, not a persisted approval. */
export const Reconciliation = Schema.Struct({
  sessionID: SessionID,
  task: Info,
  fingerprint: Schema.String,
  observedAt: Schema.Finite,
  executionSettled: Schema.Boolean,
  acceptanceReady: Schema.Boolean,
  inputs: Schema.Array(ReconciliationInput),
  integration: optional(
    Schema.Struct({ binding: Integration, contractCurrent: Schema.Boolean, issues: Schema.Array(Schema.String) }),
  ),
  overlaps: Schema.Array(Schema.Struct({ path: Schema.String, taskIDs: Schema.Array(Schema.String) })),
}).annotate({ identifier: "Todo.Reconciliation" })
export interface Reconciliation extends Schema.Schema.Type<typeof Reconciliation> {}

export class Error extends Schema.TaggedError<Error>()("SessionTodo.Error", { message: Schema.String }) {}

const Updated = ephemeral({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
