export * as Hook from "./hook"

import { Schema } from "effect"
import { optional } from "./schema"

export const Event = Schema.Literals([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "PreCompact",
  "InstructionsLoaded",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "MessageDisplay",
  "Setup",
  "PermissionDenied",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  "DirectoryAdded",
  "SessionEnd",
  "Elicitation",
  "ElicitationResult",
])
export type Event = typeof Event.Type

export const HandlerType = Schema.Literals(["command", "http", "mcp_tool", "prompt", "agent"])
export type HandlerType = typeof HandlerType.Type

const BaseHandler = {
  timeout: Schema.Number.pipe(optional),
  statusMessage: Schema.String.pipe(optional),
}

export const CommandHandler = Schema.Struct({
  ...BaseHandler,
  type: Schema.Literal("command"),
  command: Schema.String,
  async: Schema.Boolean.pipe(optional),
})

export const HttpHandler = Schema.Struct({
  ...BaseHandler,
  type: Schema.Literal("http"),
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
})

export const McpToolHandler = Schema.Struct({
  ...BaseHandler,
  type: Schema.Literal("mcp_tool"),
  server: Schema.String,
  tool: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
})

export const PromptHandler = Schema.Struct({
  ...BaseHandler,
  type: Schema.Literal("prompt"),
  prompt: Schema.String,
  model: Schema.String.pipe(optional),
})

export const AgentHandler = Schema.Struct({
  ...BaseHandler,
  type: Schema.Literal("agent"),
  prompt: Schema.String,
  agent: Schema.String.pipe(optional),
  model: Schema.String.pipe(optional),
})

export const Handler = Schema.Union([CommandHandler, HttpHandler, McpToolHandler, PromptHandler, AgentHandler])
export type Handler = typeof Handler.Type

export const Matcher = Schema.Struct({
  matcher: Schema.String.pipe(optional),
  hooks: Schema.Array(Handler),
})
export type Matcher = typeof Matcher.Type

export const Config = Schema.Record(Schema.String, Schema.Array(Matcher))
export type Config = typeof Config.Type

export const Support = Schema.Literals(["active", "unsupported", "untrusted"])
export type Support = typeof Support.Type

export const Definition = Schema.Struct({
  id: Schema.String,
  event: Event,
  matcher: Schema.String.pipe(optional),
  handler: Handler,
  source: Schema.String,
  support: Support,
  reason: Schema.String.pipe(optional),
})
export type Definition = typeof Definition.Type

export const Trust = Schema.Struct({
  trusted: Schema.Boolean,
  fingerprint: Schema.String,
})
export type Trust = typeof Trust.Type

export const Status = Schema.Struct({
  trust: Trust,
  definitions: Schema.Array(Definition),
})
export type Status = typeof Status.Type

export const ImportResult = Schema.Struct({
  imported: Schema.Int,
  target: Schema.String,
  restart_required: Schema.Boolean,
})
export type ImportResult = typeof ImportResult.Type

export const Decision = Schema.Literals(["allow", "deny"])
export type Decision = typeof Decision.Type

export const Input = Schema.Struct({
  event: Event,
  matcher: Schema.String.pipe(optional),
  session_id: Schema.String.pipe(optional),
  tool_name: Schema.String.pipe(optional),
  tool_input: Schema.Unknown.pipe(optional),
  tool_response: Schema.Unknown.pipe(optional),
  error: Schema.String.pipe(optional),
  prompt: Schema.String.pipe(optional),
  message: Schema.String.pipe(optional),
  cwd: Schema.String,
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  continue: Schema.Boolean,
  decision: Decision.pipe(optional),
  reason: Schema.String.pipe(optional),
  additionalContext: Schema.String.pipe(optional),
  systemMessage: Schema.String.pipe(optional),
  suppressOutput: Schema.Boolean.pipe(optional),
  updatedInput: Schema.Unknown.pipe(optional),
})
export type Output = typeof Output.Type
