export * as Harness from "./harness.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"
import { Capability } from "./capability.js"
import { ExecutionCapability } from "./execution-capability.js"
import { Base64 } from "./prompt.js"

export const Driver = Schema.Literals(["claude", "codex"]).annotate({ identifier: "Harness.Driver" })
export type Driver = typeof Driver.Type
export const Config = Schema.Struct({
  id: optional(Schema.NonEmptyString),
  driver: Driver,
  label: optional(Schema.NonEmptyString),
  executable: Schema.NonEmptyString,
  home: optional(AbsolutePath),
  idleTimeoutMs: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({
  identifier: "Harness.Config",
})
export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Provider = Schema.Struct({
  id: optional(Schema.NonEmptyString),
  driver: Driver,
  label: optional(Schema.NonEmptyString),
  executable: Schema.String,
  home: optional(AbsolutePath),
  credentialRevision: optional(Schema.Int),
  configured: optional(Schema.Boolean),
  idleTimeoutMs: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  installed: Schema.Boolean,
  version: optional(Schema.String),
  authenticated: optional(Schema.Boolean),
  /** The credential the CLI reports in use: an arbitrary method such as `claude.ai` or `api_key`, and the plan when known. */
  account: optional(Schema.Struct({ method: Schema.String, plan: optional(Schema.String) })),
  /** Subscription usage windows the CLI reports; `used` is a 0-100 percentage and `model` names a model-scoped window. */
  limits: optional(
    Schema.Array(
      Schema.Struct({
        window: Schema.Literals(["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "model"]),
        model: optional(Schema.String),
        used: Schema.Finite,
        resetsAt: Schema.String,
      }),
    ),
  ),
  detail: optional(Schema.String),
  models: optional(
    Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String, recommended: Schema.Boolean })),
  ),
}).annotate({ identifier: "Harness.Provider" })
export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const ComputerUseBinding = Schema.Struct({
  hostID: Schema.NonEmptyString,
  capabilityID: ExecutionCapability.ID,
  server: optional(Schema.String),
}).annotate({ identifier: "Harness.ComputerUseBinding" })
export interface ComputerUseBinding extends Schema.Schema.Type<typeof ComputerUseBinding> {}
/** Claude Code `--effort` levels. */
export const Effort = Schema.Literals(["low", "medium", "high", "xhigh", "max"]).annotate({
  identifier: "Harness.Effort",
})
export type Effort = typeof Effort.Type
/** Claude Code `--permission-mode` values Redcode offers; `default` asks before each action. */
export const PermissionMode = Schema.Literals(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]).annotate(
  {
    identifier: "Harness.PermissionMode",
  },
)
export type PermissionMode = typeof PermissionMode.Type
export const Open = Schema.Struct({
  driver: Driver,
  providerInstanceID: optional(Schema.NonEmptyString),
  directory: AbsolutePath,
  model: optional(Schema.NonEmptyString),
  effort: optional(Effort),
  permissionMode: optional(PermissionMode),
  backgroundWait: optional(Schema.Boolean),
  delegation: optional(Schema.Boolean),
  computerUse: optional(ComputerUseBinding),
}).annotate({ identifier: "Harness.Open" })
export interface Open extends Schema.Schema.Type<typeof Open> {}
export const State = Schema.Literals([
  "starting",
  "ready",
  "running",
  "waiting",
  "interrupted",
  "failed",
  "unknown",
  "closed",
]).annotate({ identifier: "Harness.State" })
export type State = typeof State.Type
export const Feature = {
  backgroundWork: "run.background",
  fork: "thread.fork",
  interrupt: "turn.interrupt",
  mcpApps: "mcp.apps",
  multipleThreadsPerRuntime: "runtime.multiple-threads",
  resume: "thread.resume",
  resumeAfterRestart: "runtime.resume-after-restart",
  steer: "turn.steer",
} as const
export type Feature = (typeof Feature)[keyof typeof Feature]
export const Capabilities = Schema.Struct({
  protocol: Capability.Protocol.pipe(optional),
  features: Capability.Features.pipe(optional),
  steer: Schema.Boolean,
  resume: Schema.Boolean,
  interrupt: Schema.Boolean,
}).annotate({ identifier: "Harness.Capabilities" })
export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}

export function supports(
  capabilities: {
    readonly features?: Readonly<Record<string, number>>
    readonly steer: boolean
    readonly resume: boolean
    readonly interrupt: boolean
  },
  feature: string,
  minimum = 1,
) {
  if (capabilities.features?.[feature] !== undefined)
    return Capability.supports(capabilities.features, feature, minimum)
  if (feature === Feature.steer) return minimum <= 1 && capabilities.steer
  if (feature === Feature.resume) return minimum <= 1 && capabilities.resume
  if (feature === Feature.interrupt) return minimum <= 1 && capabilities.interrupt
  return false
}
export const Run = Schema.Struct({
  id: Schema.String,
  driver: Driver,
  providerInstanceID: optional(Schema.NonEmptyString),
  directory: AbsolutePath,
  model: optional(Schema.String),
  effort: optional(Effort),
  permissionMode: optional(PermissionMode),
  nativeID: optional(Schema.String),
  /** The next launch forks `nativeID` into a new native session; cleared once the agent reports it. */
  fork: optional(Schema.Boolean),
  state: State,
  createdAt: Schema.String,
  detail: optional(Schema.String),
  queued: Schema.Int,
  backgroundWait: optional(Schema.Boolean),
  delegation: optional(Schema.Boolean),
  computerUse: optional(ComputerUseBinding),
  capabilities: Capabilities,
}).annotate({ identifier: "Harness.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}
export const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  options: Schema.Array(Schema.String),
}).annotate({ identifier: "Harness.Question" })
export interface Question extends Schema.Schema.Type<typeof Question> {}
export const Request = Schema.Struct({
  id: Schema.String,
  // "plan" asks the user to approve a plan the agent proposes before it starts the work.
  kind: Schema.Literals(["permission", "plan", "question", "unsupported"]),
  title: Schema.String,
  detail: Schema.String,
  questions: Schema.Array(Question),
  // The provider can keep allowing matching calls for the rest of its native session.
  session: optional(Schema.Boolean),
}).annotate({ identifier: "Harness.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}
/** A tool call the agent made, updated in place when its result arrives. */
export const Tool = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["running", "succeeded", "failed"]),
  output: optional(Schema.String),
  // The call that launched the subagent making this call.
  parent: optional(Schema.String),
}).annotate({ identifier: "Harness.Tool" })
export interface Tool extends Schema.Schema.Type<typeof Tool> {}
export const Event = Schema.Struct({
  cursor: Schema.Int,
  // "input" is an instruction delivered to the agent, so the output shows where each turn begins.
  kind: Schema.Literals(["input", "text", "reasoning", "activity", "tool", "error"]),
  text: Schema.String,
  tool: optional(Tool),
}).annotate({ identifier: "Harness.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}
const Timestamp = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000_000 }))
export const TaskWait = Schema.Struct({
  id: Schema.NonEmptyString,
  state: Schema.Literals(["waiting", "settled", "timed_out", "cancelled", "unavailable"]),
  startedAt: Timestamp,
  deadlineAt: Timestamp,
  endedAt: optional(Timestamp),
}).annotate({ identifier: "Harness.TaskWait" })
export interface TaskWait extends Schema.Schema.Type<typeof TaskWait> {}
export const Task = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.Literals(["monitor", "command", "agent", "unknown"]),
  status: Schema.Literals(["running", "succeeded", "failed", "cancelled", "unknown"]),
  nativeType: optional(Schema.String),
  toolUseID: optional(Schema.String),
  parentTaskID: optional(Schema.String),
  processID: optional(Schema.String),
  title: Schema.String,
  output: Schema.String,
  outputFile: optional(Schema.String),
  truncated: Schema.Boolean,
  updatedAt: Timestamp,
  wait: optional(TaskWait),
}).annotate({ identifier: "Harness.Task" })
export interface Task extends Schema.Schema.Type<typeof Task> {}
/** An item of the agent's own task list: Claude Code's tasks or Codex's plan. */
export const Todo = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
}).annotate({ identifier: "Harness.Todo" })
export interface Todo extends Schema.Schema.Type<typeof Todo> {}
export const Detail = Schema.Struct({
  run: Run,
  events: Schema.Array(Event),
  requests: Schema.Array(Request),
  tasks: optional(Schema.Array(Task)),
  todos: optional(Schema.Array(Todo)),
}).annotate({ identifier: "Harness.Detail" })
export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const Snapshot = Schema.Struct({ providers: Schema.Array(Provider), runs: Schema.Array(Run) }).annotate({
  identifier: "Harness.Snapshot",
})
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
/** An image attached to an instruction, within the 5 MiB of base64 the Claude Code CLI accepts per image. */
export const Image = Schema.Struct({
  mediaType: Schema.Literals(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  data: Base64.check(Schema.isMinLength(4), Schema.isMaxLength(5 * 1024 * 1024)),
}).annotate({ identifier: "Harness.Image" })
export interface Image extends Schema.Schema.Type<typeof Image> {}
export const Prompt = Schema.Struct({
  id: Schema.NonEmptyString,
  // Empty only when the instruction carries images.
  text: Schema.String,
  images: optional(Schema.Array(Image).check(Schema.isMaxLength(10))),
  delivery: Schema.Literals(["steer", "queue"]),
}).annotate({ identifier: "Harness.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Answer = Schema.Struct({
  request: Schema.String,
  allow: Schema.Boolean,
  answers: Schema.Record(Schema.String, Schema.String),
  session: optional(Schema.Boolean),
  // A decline may tell the agent why, so it can change course instead of stopping.
  message: optional(Schema.String),
}).annotate({ identifier: "Harness.Answer" })
export interface Answer extends Schema.Schema.Type<typeof Answer> {}
export const Login = Schema.Struct({
  providerInstanceID: optional(Schema.NonEmptyString),
  driver: Driver,
  state: Schema.Literals(["pending", "complete", "failed"]),
  url: optional(Schema.String),
  code: optional(Schema.String),
  detail: optional(Schema.String),
}).annotate({ identifier: "Harness.Login" })
export interface Login extends Schema.Schema.Type<typeof Login> {}

export const ComputerUseTicket = Schema.Struct({
  ticket: Schema.NonEmptyString,
  hostID: Schema.NonEmptyString,
  expiresAt: Schema.Int,
}).annotate({ identifier: "Harness.ComputerUseTicket" })
export interface ComputerUseTicket extends Schema.Schema.Type<typeof ComputerUseTicket> {}

export const ComputerUseMessage = Schema.Struct({
  ticket: Schema.NonEmptyString,
  hostID: Schema.NonEmptyString,
  message: Schema.Json,
}).annotate({ identifier: "Harness.ComputerUseMessage" })
export interface ComputerUseMessage extends Schema.Schema.Type<typeof ComputerUseMessage> {}
