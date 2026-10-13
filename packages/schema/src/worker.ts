export * as Worker from "./worker.js"

import { Schema } from "effect"
import { FileDiff } from "./file-diff.js"
import { optional } from "./schema.js"
import { Attention } from "./attention.js"
import { Form } from "./form.js"
import { Permission } from "./permission.js"
import { SessionMessage } from "./session-message.js"

export const Name = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[a-zA-Z0-9_-]+$/)).annotate({
  identifier: "Worker.Name",
})
export type Name = typeof Name.Type
const Text = Schema.String.check(Schema.isMinLength(1))
export const Registration = Schema.Struct({
  id: Name,
  url: Text,
  passwordEnv: Name,
  directories: Schema.Array(Text.check(Schema.isPattern(/^(\/|[a-zA-Z]:[\\/])/))).check(Schema.isMinLength(1)),
  tags: Schema.Array(Text),
  resourceID: optional(Text),
  environmentID: optional(Name),
  environmentProxy: optional(Schema.Boolean),
}).annotate({ identifier: "Worker.Registration" })
export interface Registration extends Schema.Schema.Type<typeof Registration> {}
export const Config = Schema.Struct({ workers: Schema.Array(Registration) }).annotate({ identifier: "Worker.Config" })
export interface Config extends Schema.Schema.Type<typeof Config> {}
/** Admission budgets owned by one coordinator; they do not enforce OS quotas. */
export const Resources = Schema.Struct({
  cpu: Schema.Int.check(Schema.isGreaterThan(0)),
  memoryBytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  maxCpuUtilization: optional(Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1))),
}).annotate({ identifier: "Worker.Resources" })
export interface Resources extends Schema.Schema.Type<typeof Resources> {}
export const Task = Schema.Struct({
  id: Name,
  prompt: Text,
  tags: optional(Schema.Array(Text)),
  worker: optional(Name),
  agent: optional(Text),
  model: optional(Schema.Struct({ providerID: Text, id: Text })),
  resources: optional(Resources),
}).annotate({ identifier: "Worker.Task" })
export interface Task extends Schema.Schema.Type<typeof Task> {}
export const Manifest = Schema.Struct({ tasks: Schema.Array(Task).check(Schema.isMinLength(1)) }).annotate({
  identifier: "Worker.Manifest",
})
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const State = Schema.Literals([
  "queued",
  "dispatching",
  "running",
  "waiting",
  "unknown",
  "succeeded",
  "failed",
  "interrupted",
]).annotate({ identifier: "Worker.State" })
export type State = typeof State.Type
export const QueueReason = Schema.Literals([
  "offline",
  "checkout-busy",
  "resources-unavailable",
  "resources-stale",
  "cpu-unavailable",
  "cpu-capacity",
  "cpu-load-unavailable",
  "cpu-load",
  "memory-unavailable",
  "memory-capacity",
]).annotate({ identifier: "Worker.QueueReason" })
export type QueueReason = typeof QueueReason.Type
export const Entry = Schema.Struct({
  id: Name,
  state: State,
  worker: optional(Name),
  url: optional(Text),
  directory: optional(Text),
  sessionID: optional(Text),
  messageID: optional(Text),
  detail: optional(Schema.String),
  queueReason: optional(QueueReason),
  text: optional(Schema.String),
}).annotate({ identifier: "Worker.Entry" })
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Report = Schema.Struct({ fingerprint: Text, tasks: Schema.Array(Entry) }).annotate({
  identifier: "Worker.Report",
})
export interface Report extends Schema.Schema.Type<typeof Report> {}
export const Register = Schema.Struct({
  id: Name,
  url: Registration.fields.url,
  directories: Registration.fields.directories,
  tags: Registration.fields.tags,
  password: Text,
  resourceID: optional(Text),
  environmentID: optional(Name),
  environmentProxy: optional(Schema.Boolean),
}).annotate({ identifier: "Worker.Register" })
export interface Register extends Schema.Schema.Type<typeof Register> {}
export const Status = Schema.Struct({
  worker: Registration,
  connection: Schema.Literals(["unchecked", "online", "offline"]),
  platform: optional(Text),
}).annotate({ identifier: "Worker.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Batch = Schema.Struct({
  id: Name,
  createdAt: Text,
  manifest: Manifest,
  report: optional(Report),
  observing: Schema.Boolean,
  error: optional(Schema.String),
  accountID: optional(Text),
  workspaceID: optional(Text),
}).annotate({ identifier: "Worker.Batch" })
export interface Batch extends Schema.Schema.Type<typeof Batch> {}
export const Snapshot = Schema.Struct({
  available: Schema.Boolean,
  reason: optional(Text),
  workers: Schema.Array(Status),
  batches: Schema.Array(Batch),
}).annotate({ identifier: "Worker.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Artifact = Schema.Struct({
  task: Entry,
  files: Schema.Array(FileDiff.Info),
  patch: Schema.String,
  patchSha256: Text,
  collectedAt: Text,
}).annotate({ identifier: "Worker.Artifact" })
export interface Artifact extends Schema.Schema.Type<typeof Artifact> {}

export const Pending = Schema.Struct({ task: Entry, attention: Attention.Entry }).annotate({
  identifier: "Worker.Pending",
})
export interface Pending extends Schema.Schema.Type<typeof Pending> {}
export const Inbox = Schema.Struct({
  data: Schema.Array(Pending),
  /** Assignments whose live requests could not be inspected. */
  unavailable: Schema.Array(Name),
}).annotate({ identifier: "Worker.Inbox" })
export interface Inbox extends Schema.Schema.Type<typeof Inbox> {}

/** The coordinator resolves the Session from its journal; the caller cannot supply a different target. */
export const Answer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("permission"),
    task: Name,
    requestID: Permission.ID,
    decision: Permission.Reply,
  }),
  Schema.Struct({ kind: Schema.Literal("question"), task: Name, formID: Form.ID, answer: Form.Answer }),
  Schema.Struct({ kind: Schema.Literal("cancel"), task: Name, formID: Form.ID }),
]).annotate({ identifier: "Worker.Answer" })
export type Answer = typeof Answer.Type

/** Native harness controls address the saved task, never an arbitrary Session or worker URL. */
export const Control = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("cancel"), task: Name }),
  Schema.Struct({ kind: Schema.Literal("interrupt"), task: Name }),
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    task: Name,
    id: SessionMessage.ID,
    text: Text,
    delivery: Schema.Literals(["steer", "queue"]),
  }),
]).annotate({ identifier: "Worker.Control" })
export type Control = typeof Control.Type
