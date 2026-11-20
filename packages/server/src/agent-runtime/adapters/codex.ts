import { Harness } from "@opencode/schema/harness"
import { Schema } from "effect"
import { backgroundWaitTool, computerUseDynamicTools, delegationTools } from "../../harness-tools"
import { object, string, type Frame, type Wire } from "../../harness-wire"
import { type AgentRuntimeAdapter } from "../adapter"
import { type AgentRuntimeEvent, type AgentRuntimeEventInput } from "../events"

const ModelPage = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.optional(Schema.NonEmptyString),
      model: Schema.optional(Schema.NonEmptyString),
      displayName: Schema.optional(Schema.String),
      isDefault: Schema.optional(Schema.Boolean),
      hidden: Schema.optional(Schema.Boolean),
    }),
  ),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
})

const RateLimitWindow = Schema.NullOr(
  Schema.Struct({
    usedPercent: Schema.Number,
    windowDurationMins: Schema.optional(Schema.NullOr(Schema.Number)),
    resetsAt: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
)
const RateLimitSnapshot = Schema.Struct({
  limitId: Schema.optional(Schema.NullOr(Schema.String)),
  limitName: Schema.optional(Schema.NullOr(Schema.String)),
  primary: Schema.optional(RateLimitWindow),
  secondary: Schema.optional(RateLimitWindow),
})
const RateLimits = Schema.Struct({
  rateLimits: RateLimitSnapshot,
  rateLimitsByLimitId: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, RateLimitSnapshot))),
})
// Codex names its windows by length: five hours and a week.
const LIMIT_WINDOWS: Record<number, "five_hour" | "seven_day"> = { 300: "five_hour", 10_080: "seven_day" }

// A ChatGPT sign-in reports its usage windows; the `codex` bucket is the account's own, others are scoped to a model.
async function limits(wire: Wire): Promise<Harness.Provider["limits"]> {
  const value = Schema.decodeUnknownSync(RateLimits)(await wire.request("account/rateLimits/read", {}, "codex"))
  return Object.values(value.rateLimitsByLimitId ?? { codex: value.rateLimits }).flatMap((snapshot) => {
    const model = snapshot.limitId && snapshot.limitId !== "codex" ? snapshot.limitName || snapshot.limitId : undefined
    const windows = [snapshot.primary, snapshot.secondary].flatMap((window) => (window?.resetsAt ? [window] : []))
    // A model's windows share one label, so its fullest window stands for the bucket.
    const shown = model ? [...windows].sort((a, b) => b.usedPercent - a.usedPercent).slice(0, 1) : windows
    return shown.flatMap((window) => {
      const kind = model ? "model" : LIMIT_WINDOWS[window.windowDurationMins ?? 0]
      return kind && window.resetsAt
        ? [
            {
              window: kind,
              ...(model ? { model } : {}),
              used: window.usedPercent,
              resetsAt: new Date(window.resetsAt * 1000).toISOString(),
            },
          ]
        : []
    })
  })
}

async function initialize(wire: Wire, appVersion: string, experimental: boolean) {
  await wire.request(
    "initialize",
    {
      clientInfo: { name: "redcode", title: "Redcode", version: appVersion },
      ...(experimental ? { capabilities: { experimentalApi: true } } : {}),
    },
    "codex",
  )
  wire.send({ method: "initialized", params: {} })
}

async function models(wire: Wire) {
  const models: NonNullable<Harness.Provider["models"]>[number][] = []
  let cursor: string | undefined
  do {
    const page = Schema.decodeUnknownSync(ModelPage)(
      await wire.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, "codex"),
    )
    models.push(
      ...page.data.flatMap((model) => {
        const id = model.model ?? model.id
        return id && !model.hidden
          ? [{ id, label: model.displayName || id, recommended: model.isDefault === true }]
          : []
      }),
    )
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return models
}

function events(input: AgentRuntimeEventInput): AgentRuntimeEvent[] {
  const params = object(input.frame.params)
  if (params.threadId && params.threadId !== input.run.nativeID) return []
  if (params.turnId && input.turn && params.turnId !== input.turn) return []
  const method = string(input.frame.method)
  if (method === "thread/tokenUsage/updated") {
    const usage = object(object(params.tokenUsage).total)
    const cached = count(usage.cachedInputTokens)
    const tokens = {
      input: subtract(count(usage.inputTokens), cached),
      output: subtract(count(usage.outputTokens), count(usage.reasoningOutputTokens)),
      reasoning: count(usage.reasoningOutputTokens),
      cache: { read: cached, write: null },
    }
    return [
      {
        type: "usage",
        metric: {
          identity: `usage:${JSON.stringify(tokens)}`,
          tokens,
          cost: null,
          scope: "session",
          status: "busy",
        },
      },
    ]
  }
  if (input.frame.id !== undefined && method) {
    const questions = runtimeQuestions(params.questions)
    return [
      {
        type: "request",
        frame: input.frame,
        key: String(input.frame.id),
        title: method,
        detail:
          method === PERMISSIONS_REQUEST
            ? permissionsDetail(params)
            : [string(params.command), string(params.reason)].filter(Boolean).join("\n"),
        questions,
        session: [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          PERMISSIONS_REQUEST,
        ].includes(method),
        supported: [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
          PERMISSIONS_REQUEST,
        ].includes(method),
      },
    ]
  }
  if (method === "serverRequest/resolved") return [{ type: "request.resolved", id: String(params.requestId) }]
  if (method === "turn/started") return [{ type: "started", turn: string(object(params.turn).id) }]
  if (method === "item/agentMessage/delta") return [{ type: "text", text: string(params.delta) }]
  // Plan mode proposes its plan as an item of its own, which is the turn's reply.
  if (method === "item/plan/delta") return [{ type: "text", text: string(params.delta) }]
  // Reasoning streams as summary sections (OpenAI models) or as raw text (open models).
  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta")
    return [{ type: "reasoning", text: string(params.delta) }]
  if (method === "item/reasoning/summaryPartAdded" && Number(params.summaryIndex) > 0)
    return [{ type: "reasoning", text: "\n\n" }]
  if (method === "turn/plan/updated")
    return [
      {
        type: "todos",
        todos: (Array.isArray(params.plan) ? params.plan : []).map((item, index) => {
          const step = object(item)
          return {
            id: String(index + 1),
            content: string(step.step),
            status:
              step.status === "inProgress" ? "in_progress" : step.status === "completed" ? "completed" : "pending",
          }
        }),
      },
    ]
  if (method === "item/started") {
    const item = object(params.item)
    const name = toolName(item)
    if (name) return [{ type: "tool", id: string(item.id), name, title: toolTitle(name, item) }]
    // Messages and reasoning arrive as their own text.
    return ["agentMessage", "reasoning", "userMessage", "plan"].includes(string(item.type))
      ? []
      : [{ type: "activity", text: string(item.type) }]
  }
  if (method === "item/completed") {
    const item = object(params.item)
    // Web searches and image views carry no status; they complete when their item does.
    const status =
      item.status === undefined || item.status === "completed"
        ? "succeeded"
        : item.status === "failed"
          ? "failed"
          : item.status === "declined"
            ? "stopped"
            : undefined
    return toolName(item) && status
      ? [{ type: "tool.result", id: string(item.id), status, output: toolOutput(item), diff: fileDiff(item) }]
      : []
  }
  if (method !== "turn/completed") return []
  const turn = object(params.turn)
  const outcome = turn.status === "failed" ? "failed" : turn.status === "interrupted" ? "interrupted" : "completed"
  return [
    {
      type: "completed",
      outcome,
      detail: string(object(turn.error).message) || undefined,
      metrics: [
        {
          identity: `turn:${string(turn.id) || input.turn}`,
          tokens: null,
          cost: null,
          scope: "interaction",
          status: outcome === "failed" ? "failed" : outcome === "interrupted" ? "cancelled" : "succeeded",
        },
      ],
    },
  ]
}

const TOOL_ITEMS: Record<string, string> = {
  commandExecution: "Command",
  fileChange: "Edit",
  webSearch: "Web search",
  imageView: "View image",
  imageGeneration: "Generate image",
  collabAgentToolCall: "Agent",
}

function toolName(item: Frame) {
  if (item.type === "mcpToolCall") return `${string(item.server)}/${string(item.tool)}`
  if (item.type === "dynamicToolCall") return string(item.tool)
  return TOOL_ITEMS[string(item.type)] ?? ""
}

// The command, files, query or prompt a call acts on, so the run shows what Codex is doing.
function toolTitle(name: string, item: Frame) {
  const changes = Array.isArray(item.changes)
    ? item.changes
        .map((change) => string(object(change).path))
        .filter(Boolean)
        .join(", ")
    : ""
  const target = (
    string(item.command) ||
    changes ||
    string(item.query) ||
    string(item.path) ||
    string(item.prompt)
  ).trim()
  return target ? `${name} · ${target.split("\n")[0].slice(0, 200)}` : name
}

// Each changed file's path, then its diff.
function fileDiff(item: Frame) {
  return Array.isArray(item.changes)
    ? item.changes
        .map(object)
        .map((change) => {
          // A new or removed file arrives as its content rather than as a diff.
          const kind = string(object(change.kind).type)
          const body =
            kind === "add" || kind === "delete"
              ? string(change.diff)
                  .replace(/\n$/, "")
                  .split("\n")
                  .map((line) => (kind === "add" ? "+" : "-") + line)
                  .join("\n")
              : string(change.diff)
          return [string(change.path), body].filter(Boolean).join("\n")
        })
        .join("\n")
        .slice(0, 16_000)
    : ""
}

function toolOutput(item: Frame) {
  const content = Array.isArray(item.contentItems)
    ? item.contentItems
        .map((part) => string(object(part).text))
        .filter(Boolean)
        .join("\n")
    : ""
  return (
    string(item.aggregatedOutput) ||
    content ||
    string(object(item.error).message) ||
    (item.result ? JSON.stringify(item.result) : "")
  ).slice(0, 8000)
}

// Codex asks before leaving its workspace sandbox; auto routes those requests to its own reviewer first.
function permissions(mode: Harness.PermissionMode | undefined) {
  // Full access asks nothing, but MCP servers' questions still reach the user: "never" would refuse them unseen.
  if (mode === "bypassPermissions")
    return {
      approvalPolicy: {
        granular: {
          mcp_elicitations: true,
          request_permissions: false,
          rules: false,
          sandbox_approval: false,
          skill_approval: false,
        },
      },
      sandbox: "danger-full-access",
    }
  return {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    ...(mode === "auto" ? { approvalsReviewer: "auto_review" } : {}),
  }
}

// Codex asks for network or file access beyond its sandbox; granting returns the requested profile.
const PERMISSIONS_REQUEST = "item/permissions/requestApproval"

// The reason Codex gives, then each access it asks for.
function permissionsDetail(params: Frame) {
  const permissions = object(params.permissions)
  const fileSystem = object(permissions.fileSystem)
  const legacy = (access: string, paths: unknown) =>
    Array.isArray(paths) ? paths.map((path) => `${access} ${string(path)}`) : []
  const entries = Array.isArray(fileSystem.entries)
    ? fileSystem.entries.map(object).map((entry) => {
        const path = object(entry.path)
        return `${string(entry.access)} ${string(path.path) || string(path.pattern) || string(object(path.value).kind)}`
      })
    : []
  return [
    string(params.reason),
    ...(object(permissions.network).enabled === true ? ["Network access"] : []),
    ...entries,
    ...legacy("read", fileSystem.read),
    ...legacy("write", fileSystem.write),
  ]
    .filter(Boolean)
    .join("\n")
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function subtract(total: number | null, part: number | null) {
  return total === null || part === null ? null : Math.max(0, total - part)
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

export const CodexAgentRuntime: AgentRuntimeAdapter = {
  driver: "codex",
  environment: {},
  // Redcode talks to the app-server over stdio.
  reservedArguments: [
    "--listen",
    "--code-mode-host",
    "--ws-auth",
    "--ws-token-file",
    "--ws-token-sha256",
    "--ws-shared-secret-file",
  ],
  // Codex's workspace sandbox already accepts edits; plan is its own collaboration mode.
  permissionModes: ["default", "plan", "auto", "bypassPermissions"],
  installPackage: "@openai/codex",
  capabilities: {
    backgroundWork: true,
    // Codex's decline has no reason field; its decline lets the turn continue, so the reason is steered in.
    declineMessage: false,
    fork: false,
    interrupt: true,
    mcpApps: true,
    multipleThreadsPerRuntime: true,
    resume: true,
    resumeAfterRestart: true,
    steer: true,
  },
  accepts(input) {
    const params = object(input.frame.params)
    if (params.threadId && params.threadId !== input.run.nativeID) return false
    return !params.turnId || !input.turn || params.turnId === input.turn
  },
  events,
  initialize: (input) => initialize(input.wire, input.appVersion, true),
  answer(input) {
    const id = input.item.frame.id ?? input.answer.request
    if (input.item.request.kind === "unsupported") {
      input.wire.send({ id, error: { code: -32601, message: "Unsupported by Redcode" } })
      return
    }
    if (input.item.request.kind === "question") {
      input.wire.send({
        id,
        result: {
          answers: Object.fromEntries(
            input.item.request.questions.map((question) => [
              question.id,
              { answers: input.answer.allow ? [input.answer.answers[question.id] ?? ""] : [] },
            ]),
          ),
        },
      })
      return
    }
    if (input.item.request.title === PERMISSIONS_REQUEST) {
      // A decline grants nothing; Codex then continues inside its sandbox.
      input.wire.send({
        id,
        result: {
          permissions: input.answer.allow ? object(object(input.item.frame.params).permissions) : {},
          scope: input.answer.session ? "session" : "turn",
        },
      })
      return
    }
    const decision = input.answer.session ? "acceptForSession" : "accept"
    input.wire.send({ id, result: { decision: input.answer.allow ? decision : "decline" } })
  },
  launchArgs: () => ["app-server"],
  async open(input) {
    const result = await input.wire.request(
      input.run.nativeID ? "thread/resume" : "thread/start",
      {
        ...(input.run.nativeID ? { threadId: input.run.nativeID } : {}),
        cwd: input.directory,
        ...(input.run.model ? { model: input.run.model } : {}),
        ...permissions(input.run.permissionMode),
        config: {
          // Codex offers update_plan only when asked for it; its plan becomes the run's task list.
          "tools.update_plan.enabled": true,
          // The 1 s default leaves a cold npx or uvx MCP server out of the first request.
          mcp_optional_startup_grace_ms: 10_000,
        },
        ...(!input.run.nativeID && (input.run.backgroundWait || input.run.delegation || input.computerUse)
          ? {
              dynamicTools: [
                ...(input.run.backgroundWait ? [{ type: "function", ...backgroundWaitTool }] : []),
                ...(input.run.delegation ? delegationTools.map((tool) => ({ type: "function", ...tool })) : []),
                ...computerUseDynamicTools(input.computerUse),
              ],
            }
          : {}),
      },
      input.run.driver,
    )
    const nativeID = string(object(result.thread).id)
    if (!nativeID) throw new Error("Codex did not return a thread identity")
    if (string(result.model)) threadModels.set(nativeID, string(result.model))
    return { nativeID }
  },
  async prompt(input) {
    const result = await input.wire.request(
      input.steer ? "turn/steer" : "turn/start",
      {
        threadId: input.run.nativeID ?? "",
        ...(input.steer ? { expectedTurnId: input.turn } : {}),
        // The effort holds for this turn and the ones after it.
        ...(!input.steer && input.run.effort ? { effort: input.run.effort } : {}),
        ...(input.steer ? {} : turnMode(input.run)),
        input: [
          ...(input.prompt.images ?? []).map((image) => ({
            type: "image",
            url: `data:${image.mediaType};base64,${image.data}`,
          })),
          ...(input.prompt.text.trim() ? [{ type: "text", text: input.prompt.text, text_elements: [] }] : []),
        ],
      },
      input.run.driver,
    )
    return input.steer ? {} : { turn: string(object(result.turn).id) }
  },
  async interrupt(input) {
    if (!input.turn) return
    await input.wire.request(
      "turn/interrupt",
      { threadId: input.run.nativeID ?? "", turnId: input.turn },
      input.run.driver,
    )
  },
}

/** The model each thread runs, as Codex reported it; a collaboration mode must name one. */
const threadModels = new Map<string, string>()

/**
 * Every turn names its collaboration mode, so leaving plan mode clears it, and asks for reasoning summaries, which
 * some catalogues turn off by default.
 */
function turnMode(run: Harness.Run) {
  const model = run.model ?? (run.nativeID ? threadModels.get(run.nativeID) : undefined)
  return {
    summary: "auto",
    ...(model
      ? {
          collaborationMode: {
            mode: run.permissionMode === "plan" ? "plan" : "default",
            settings: { model, ...(run.effort ? { reasoning_effort: run.effort } : {}) },
          },
        }
      : {}),
  }
}

export const CodexRuntimeProtocol = { initialize, models, limits }
