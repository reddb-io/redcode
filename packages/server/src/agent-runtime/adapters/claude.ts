import { type AgentRuntimeAdapter } from "../adapter"
import { Harness } from "@opencode/schema/harness"
import { object, string } from "../../harness-wire"
import { type AgentRuntimeEvent, type AgentRuntimeEventInput } from "../events"

function events(input: AgentRuntimeEventInput): AgentRuntimeEvent[] {
  const value = input.frame
  if (value.type === "control_cancel_request")
    return [{ type: "request.resolved", id: string(value.request_id) }]
  if (value.type === "control_request") {
    const request = object(value.request)
    const requestInput = object(request.input)
    return [
      {
        type: "request",
        frame: value,
        key: string(value.request_id),
        title: string(request.tool_name) || string(request.subtype),
        detail: JSON.stringify(requestInput).slice(0, 8000),
        questions: runtimeQuestions(requestInput.questions),
        supported: request.subtype === "can_use_tool",
      },
    ]
  }
  if (value.type === "system" && value.subtype === "init") {
    const nativeID = string(value.session_id)
    return nativeID ? [{ type: "session", nativeID }] : []
  }
  if (value.type === "assistant" && !value.parent_tool_use_id) {
    const message = object(value.message)
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((item): AgentRuntimeEvent[] => {
      const block = object(item)
      if (block.type === "text") return [{ type: "text", text: string(block.text) }]
      if (block.type === "tool_use") return [{ type: "activity", text: string(block.name) }]
      return []
    })
  }
  if (value.type !== "result") return []
  const failed = value.is_error === true
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
      outcome: failed ? "failed" : "completed",
      detail,
      nativeID: string(value.session_id) || input.run.nativeID,
      metrics: [
        {
          identity: `result:${string(value.uuid) || input.inputID || "unknown"}`,
          tokens,
          cost: null,
          scope: "interaction",
          status: failed ? "failed" : "succeeded",
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

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
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
    fork: false,
    interrupt: true,
    mcpApps: false,
    multipleThreadsPerRuntime: false,
    resume: true,
    resumeAfterRestart: true,
    steer: false,
  },
  accepts: () => true,
  events,
  async initialize(input) {
    await input.wire.request(
      "initialize",
      {
        hooks: {},
        ...(input.run.backgroundWait || input.run.delegation
          ? {
              sdkMcpServers: [
                ...(input.run.backgroundWait ? ["redcode_wait"] : []),
                ...(input.run.delegation ? ["redcode"] : []),
              ],
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
            }
          : { behavior: "deny", message: "Declined by user" },
      },
    })
  },
  launchArgs: (run) => [
    "--print",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    "default",
    ...(run.nativeID ? ["--resume", run.nativeID] : []),
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
      message: { role: "user", content: input.prompt.text },
      parent_tool_use_id: null,
    })
    return {}
  },
  async interrupt(input) {
    await input.wire.request("interrupt", {}, input.run.driver)
  },
}
