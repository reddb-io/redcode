import { type AgentRuntimeAdapter, type AgentRuntimeOpen } from "../adapter"
import { Harness } from "@opencode/schema/harness"
import { Schema } from "effect"
import { object, string, type Frame, type Wire } from "../../harness-wire"
import { type AgentRuntimeEvent, type AgentRuntimeEventInput } from "../events"

const STREAM_ARGS = ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json"]

const ModelList = Schema.Struct({
  models: Schema.optional(
    Schema.Array(Schema.Struct({ value: Schema.NonEmptyString, displayName: Schema.optional(Schema.String) })),
  ),
})

// Initialize alone lists the models without a model request; hooks and configured MCP servers stay off.
const catalogArgs = [
  ...STREAM_ARGS,
  "--permission-prompt-tool",
  "stdio",
  "--strict-mcp-config",
  "--settings",
  JSON.stringify({ disableAllHooks: true }),
]

async function models(wire: Wire) {
  const catalog = Schema.decodeUnknownSync(ModelList)(await wire.request("initialize", { hooks: {} }, "claude"))
  // "default" is the agent's own choice, which the model selector already offers.
  return (catalog.models ?? []).flatMap((model) =>
    model.value === "default" ? [] : [{ id: model.value, label: model.displayName || model.value, recommended: false }],
  )
}

const UsageWindow = Schema.Struct({
  utilization: Schema.NullOr(Schema.Number),
  resets_at: Schema.NullOr(Schema.String),
})
const Usage = Schema.Struct({
  rate_limits: Schema.NullOr(
    Schema.Struct({
      five_hour: Schema.optional(Schema.NullOr(UsageWindow)),
      seven_day: Schema.optional(Schema.NullOr(UsageWindow)),
      seven_day_opus: Schema.optional(Schema.NullOr(UsageWindow)),
      seven_day_sonnet: Schema.optional(Schema.NullOr(UsageWindow)),
      model_scoped: Schema.optional(
        Schema.Array(Schema.Struct({ display_name: Schema.String, ...UsageWindow.fields })),
      ),
    }),
  ),
})
const USAGE_WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const

// The CLI marks get_usage experimental and reads the subscription's own usage endpoint; callers treat a
// failure as "no limits reported".
async function limits(wire: Wire): Promise<Harness.Provider["limits"]> {
  const usage = Schema.decodeUnknownSync(Usage)(
    await wire.request("get_usage", { skip_behaviors: true }, "claude"),
  ).rate_limits
  if (!usage) return undefined
  return [
    ...USAGE_WINDOWS.flatMap((window) => {
      const value = usage[window]
      return value?.utilization != null && value.resets_at
        ? [{ window, used: value.utilization, resetsAt: value.resets_at }]
        : []
    }),
    ...(usage.model_scoped ?? []).flatMap((value) =>
      value.utilization !== null && value.resets_at
        ? [{ window: "model" as const, model: value.display_name, used: value.utilization, resetsAt: value.resets_at }]
        : [],
    ),
  ]
}

// The oldest Claude Code release the CLI contract test has passed against.
const minimumVersion = "2.1.327"

export const ClaudeRuntimeProtocol = { catalogArgs, models, limits, minimumVersion }

// Claude Code defers MCP tools behind ToolSearch, so the model learns when to load Redcode's tools from here.
// Keep each text fixed per capability: Claude Code records the system prompt on a session's first request.
const INSTRUCTIONS_HEADER =
  "Redcode hosts this session and adds the tools below. If they are not loaded yet, load them with ToolSearch when you need them."
const WAIT_INSTRUCTIONS =
  "- `redcode_background_wait` (server `redcode_wait`): before you end your turn, wait for a background command or Monitor task you started and still need. Do not wait for services or watchers you intend to leave running."
const DELEGATION_INSTRUCTIONS =
  "- `redcode_delegate_task`, `redcode_task_status` and `redcode_task_cancel` (server `redcode`): hand a task to Redcode, Codex or Claude in this checkout. Use your own Agent tool for ordinary subagent work. A delegated result is delivered to you when it finishes, so do not poll for it."
const COMPUTER_USE_INSTRUCTIONS =
  "- The Computer Use tools (server `redcode_computer_use`) operate the desktop bound to this run when a task needs it."

function redcodeTools(input: AgentRuntimeOpen) {
  return [
    ...(input.run.backgroundWait ? [{ server: "redcode_wait", text: WAIT_INSTRUCTIONS }] : []),
    ...(input.run.delegation ? [{ server: "redcode", text: DELEGATION_INSTRUCTIONS }] : []),
    ...(input.computerUse ? [{ server: "redcode_computer_use", text: COMPUTER_USE_INSTRUCTIONS }] : []),
  ]
}

// Messages whose text arrived as deltas; their assistant frames repeat that text.
const streamed = new Map<string, Set<string>>()

function events(input: AgentRuntimeEventInput): AgentRuntimeEvent[] {
  const value = input.frame
  if (value.type === "stream_event") {
    if (value.parent_tool_use_id) return []
    const event = object(value.event)
    if (event.type === "message_start") {
      const id = string(object(event.message).id)
      if (id) streamed.set(input.run.id, (streamed.get(input.run.id) ?? new Set<string>()).add(id))
      return []
    }
    const delta = object(event.delta)
    return event.type === "content_block_delta" && delta.type === "text_delta"
      ? [{ type: "text", text: string(delta.text) }]
      : []
  }
  if (value.type === "control_cancel_request")
    return [{ type: "request.resolved", id: string(value.request_id) }]
  if (value.type === "control_request") {
    const request = object(value.request)
    const requestInput = object(request.input)
    const questions = runtimeQuestions(requestInput.questions)
    return [
      {
        type: "request",
        frame: value,
        key: string(value.request_id),
        title: string(request.tool_name) || string(request.subtype),
        detail: requestDetail(string(request.tool_name), requestInput, questions.length > 0),
        plan: string(request.tool_name) === "ExitPlanMode",
        questions,
        // Plan approvals and questions always need the user.
        session: request.subtype === "can_use_tool" && request.requires_user_interaction !== true && !questions.length,
        supported: request.subtype === "can_use_tool",
      },
    ]
  }
  // Approving a plan moves the CLI out of plan mode; later launches must not restore the mode it left.
  if (value.type === "system" && value.subtype === "status")
    return Schema.is(Harness.PermissionMode)(value.permissionMode)
      ? [{ type: "permissionMode", mode: value.permissionMode }]
      : []
  if (value.type === "system" && value.subtype === "init") {
    const nativeID = string(value.session_id)
    return nativeID ? [{ type: "session", nativeID }] : []
  }
  if (value.type === "rate_limit_event") return usageLimit(object(value.rate_limit_info))
  if (value.type === "assistant" && value.parent_tool_use_id) {
    const content = object(value.message).content
    if (!Array.isArray(content)) return []
    return content.flatMap((item): AgentRuntimeEvent[] => {
      const block = object(item)
      return block.type === "tool_use" ? [{ type: "activity", text: `Subagent · ${toolActivity(block)}` }] : []
    })
  }
  if (value.type === "assistant") {
    const message = object(value.message)
    if (!Array.isArray(message.content)) return []
    const repeated = !!message.id && streamed.get(input.run.id)?.has(string(message.id)) === true
    return message.content.flatMap((item): AgentRuntimeEvent[] => {
      const block = object(item)
      if (block.type === "text") return repeated ? [] : [{ type: "text", text: string(block.text) }]
      // Each thinking block arrives whole in its own assistant frame, so it is shown once as a block.
      if (block.type === "thinking")
        return string(block.thinking).trim() ? [{ type: "reasoning", text: string(block.thinking) }] : []
      if (block.type === "tool_use") return [{ type: "activity", text: toolActivity(block) }]
      return []
    })
  }
  if (value.type !== "result") return []
  streamed.delete(input.run.id)
  // An interrupt ends the cut turn with an error result whose terminal reason names the abort.
  const interrupted = ["aborted_streaming", "aborted_tools"].includes(string(value.terminal_reason))
  const failed = value.is_error === true && !interrupted
  const detail = failed ? string(value.result) || "Claude execution failed" : undefined
  const usage = object(value.usage)
  const tokens = Object.keys(usage).length
    ? {
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        reasoning: null,
        cache: { read: count(usage.cache_read_input_tokens), write: count(usage.cache_creation_input_tokens) },
      }
    : null
  const modelUsage = object(value.modelUsage)
  const models = Object.keys(modelUsage)
  const totals = models.map((model) => object(modelUsage[model]))
  const sum = (field: string) =>
    totals.length && totals.every((model) => count(model[field]) !== null)
      ? totals.reduce((total, model) => total + (count(model[field]) ?? 0), 0)
      : null
  const cumulative = totals.length
    ? {
        input: sum("inputTokens"),
        output: sum("outputTokens"),
        reasoning: null,
        cache: { read: sum("cacheReadInputTokens"), write: sum("cacheCreationInputTokens") },
      }
    : null
  const cost = count(value.total_cost_usd)
  return [
    {
      type: "completed",
      outcome: interrupted ? "interrupted" : failed ? "failed" : "completed",
      detail,
      nativeID: string(value.session_id) || input.run.nativeID,
      metrics: [
        {
          identity: `result:${string(value.uuid) || input.inputID || "unknown"}`,
          tokens,
          cost: null,
          scope: "interaction",
          status: failed ? "failed" : interrupted ? "cancelled" : "succeeded",
          model: models.length === 1 ? models[0] : undefined,
        },
        {
          identity: `total:${JSON.stringify({ cumulative, cost })}`,
          tokens: cumulative,
          cost,
          scope: "session",
          status: failed ? "failed" : "idle",
          model: models.length === 1 ? models[0] : null,
          pricing: "estimated",
        },
      ],
    },
  ]
}

const USAGE_LIMIT_WINDOWS: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "7-day",
  seven_day_opus: "7-day Opus",
  seven_day_sonnet: "7-day Sonnet",
  overage: "overage",
}

// Subscription sessions report their usage windows; the CLI repeats a frame only when its state changes.
function usageLimit(info: Frame): AgentRuntimeEvent[] {
  const status = string(info.status)
  if (status !== "rejected" && status !== "allowed_warning") return []
  const window = USAGE_LIMIT_WINDOWS[string(info.rateLimitType)]
  const limit = window ? `the ${window} usage limit` : "a usage limit"
  const reset =
    typeof info.resetsAt === "number" && info.resetsAt > 0 && info.resetsAt < 8.64e12
      ? ` It resets at ${new Date(info.resetsAt * 1000).toISOString()}.`
      : ""
  return status === "rejected"
    ? [{ type: "error", text: `Claude reached ${limit}.${reset}` }]
    : [{ type: "activity", text: `Claude is close to ${limit}.${reset}` }]
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

const TOOL_TARGETS = [
  "command",
  "file_path",
  "notebook_path",
  "pattern",
  "path",
  "url",
  "query",
  "skill",
  "description",
]

// A tool call with the command, file or query it acts on, so the run shows what Claude is doing.
function toolActivity(block: Frame) {
  const input = object(block.input)
  const target = TOOL_TARGETS.map((field) => string(input[field]).trim()).find(Boolean)
  return target ? `${string(block.name)} · ${target.split("\n")[0].slice(0, 200)}` : string(block.name)
}

// The plan, command or tool input the user is approving; questions render as their own fields.
function requestDetail(tool: string, input: Frame, questions: boolean) {
  if (questions) return ""
  // ExitPlanMode carries the plan Claude wrote to its plan file.
  if (string(input.plan).trim()) return string(input.plan)
  return [tool, string(input.command) || JSON.stringify(input)].filter(Boolean).join("\n").slice(0, 8000)
}

// Claude Code's own suggestions, kept to this session and without switching its permission mode, which
// stays the run's choice. A tool rule covers requests that carry no suggestion.
function sessionPermissions(request: Frame) {
  const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : []
  const updates = suggestions
    .map(object)
    .filter((suggestion) => suggestion.type !== "setMode")
    .map((suggestion) => ({ ...suggestion, destination: "session" }))
  return updates.length
    ? updates
    : [
        {
          type: "addRules",
          rules: [{ toolName: string(request.tool_name) }],
          behavior: "allow",
          destination: "session",
        },
      ]
}

function runtimeQuestions(input: unknown): Harness.Request["questions"] {
  if (!Array.isArray(input)) return []
  return input.map((item, index) => {
    const value = object(item)
    return {
      id: string(value.id) || string(value.question) || String(index),
      text: string(value.question) || string(value.header),
      options: Array.isArray(value.options)
        ? value.options.map((option) => string(object(option).label)).filter(Boolean)
        : [],
    }
  })
}

export const ClaudeAgentRuntime: AgentRuntimeAdapter = {
  driver: "claude",
  installPackage: "@anthropic-ai/claude-code",
  capabilities: {
    backgroundWork: true,
    fork: true,
    interrupt: true,
    mcpApps: false,
    multipleThreadsPerRuntime: false,
    resume: true,
    resumeAfterRestart: true,
    steer: true,
  },
  accepts: () => true,
  events,
  async initialize(input) {
    const tools = redcodeTools(input)
    await input.wire.request(
      "initialize",
      {
        hooks: {},
        // Redcode only appends; Claude Code's own system prompt stays in place.
        ...(tools.length
          ? {
              sdkMcpServers: tools.map((tool) => tool.server),
              appendSystemPrompt: [INSTRUCTIONS_HEADER, ...tools.map((tool) => tool.text)].join("\n"),
            }
          : {}),
      },
      input.run.driver,
    )
  },
  answer(input) {
    const request = object(input.item.frame.request)
    input.wire.send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: input.answer.request,
        response: input.answer.allow
          ? {
              behavior: "allow",
              updatedInput: {
                ...object(request.input),
                ...(input.item.request.kind === "question" ? { answers: input.answer.answers } : {}),
              },
              ...(input.answer.session ? { updatedPermissions: sessionPermissions(request) } : {}),
            }
          : { behavior: "deny", message: "Declined by user" },
      },
    })
  },
  launchArgs: (run) => [
    ...STREAM_ARGS,
    "--include-partial-messages",
    // Readable reasoning summaries instead of the default one-line progress updates.
    "--thinking-display",
    "summarized",
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    run.permissionMode ?? "default",
    // The CLI accepts bypassPermissions only when skipping checks is explicitly allowed.
    ...(run.permissionMode === "bypassPermissions" ? ["--allow-dangerously-skip-permissions"] : []),
    ...(run.effort ? ["--effort", run.effort] : []),
    ...(run.nativeID ? ["--resume", run.nativeID, ...(run.fork ? ["--fork-session"] : [])] : []),
    ...(run.model ? ["--model", run.model] : []),
  ],
  async open() {
    return {}
  },
  async prompt(input) {
    input.wire.send({
      type: "user",
      uuid: input.prompt.id,
      session_id: input.run.nativeID ?? "",
      message: {
        role: "user",
        // Images go first, as the Messages API recommends; an image-only instruction carries no text block.
        content: input.prompt.images?.length
          ? [
              ...input.prompt.images.map((image) => ({
                type: "image",
                source: { type: "base64", media_type: image.mediaType, data: image.data },
              })),
              ...(input.prompt.text.trim() ? [{ type: "text", text: input.prompt.text }] : []),
            ]
          : input.prompt.text,
      },
      parent_tool_use_id: null,
    })
    return {}
  },
  async interrupt(input) {
    await input.wire.request("interrupt", {}, input.run.driver)
  },
}
