export * as SessionTodo from "./session-todo"

import { Schema, SchemaGetter } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { optional, PositiveInt } from "./schema"

export const Status = Schema.Literals(["pending", "in_progress", "blocked", "completed", "cancelled"])
export const Priority = Schema.Literals(["high", "medium", "low"])

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
  content: Schema.String.check(Schema.isMinLength(1)),
  criterion: Schema.String.check(Schema.isMinLength(1)),
  quote: Schema.String.check(Schema.isMinLength(1)),
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
}

export const Input = Schema.Struct({
  ...tracking,
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
      description: "Brief description of the task; required when creating, optional when updating by id",
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
// boundary and fold them into content before the canonical Input is validated, so the JSON schema
// the model sees still only advertises content.
export const ModelInput = Schema.Struct({
  ...Input.fields,
  // Empty content is checked after folding, so {"content":"","title":"X"} still becomes X.
  content: optional(Schema.String),
  text: optional(Schema.String),
  title: optional(Schema.String),
  task: optional(Schema.String),
}).pipe(
  Schema.decodeTo(Input, {
    decode: SchemaGetter.transform(({ text, title, task, ...item }) => {
      const content = [item.content, text, title, task].find((value) => value?.trim()) ?? item.content
      return content === undefined ? item : { ...item, content }
    }),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)

export const Info = Schema.Struct({
  // Old tool results and event snapshots predate task identity and closed states.
  // Keep the read contract compatible; all new writes pass through Input.
  ...tracking,
  legacyStatus: optional(Schema.String),
  source: optional(Source),
  criterion: optional(Schema.String),
  evidence: optional(Evidence),
  scopeChange: optional(
    Schema.Struct({
      messageID: Schema.String,
      quote: Schema.String,
      created: optional(Schema.Finite),
      /** The model's words when they quoted no user message and the latest request was attached instead. */
      paraphrase: optional(Schema.String),
    }),
  ),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
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

export class Error extends Schema.TaggedErrorClass<Error>()("SessionTodo.Error", { message: Schema.String }) {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
