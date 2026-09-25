import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"
import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { LoopGuard } from "@reddb-io/redcode-core/session/loop-guard"
import { SessionStopLoss } from "@reddb-io/redcode-core/session/stop-loss"
import { Verbose } from "@reddb-io/redcode-core/observability/verbose"
import { DesignStudio } from "@/design/studio"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import path from "path"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionRetry } from "@reddb-io/redcode-core/session/retry"
import { Prompt } from "@reddb-io/redcode-core/session/prompt"
import { EventV2 } from "@reddb-io/redcode-core/event"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { CompactionGuard } from "./compaction-guard"
import { TuiEvent } from "@/server/tui-event"
import { hardLimit, usable as usableTokens } from "./overflow"
import { SessionPreflight } from "./preflight"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { ProviderTransform } from "@/provider/transform"
import { ComboMember } from "@/provider/combo-member"
import { contextOverflowNumbers } from "@reddb-io/redcode-llm"
import { Token } from "@/util/token"
import { SystemPrompt } from "./system"
import { SessionContext } from "./context"
import { SessionContextEpoch } from "@reddb-io/redcode-core/session/context-epoch"
import { SessionHistory } from "@reddb-io/redcode-core/session/history"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@reddb-io/redcode-core/session/runner/max-steps"

/** How often the watchdog looks. Well below the thresholds it is checking against. */
const STALL_POLL_SECONDS = 15
/** Messages the stop-loss reads back: comfortably more than the steps its ceiling allows. */
const STOP_LOSS_WINDOW = 64

// Keep evaluator context readable without serializing binary attachments or provider metadata.
const intelligenceHistory = (messages: ReadonlyArray<SessionV1.WithParts>) =>
  messages.map((message) => ({
    id: message.info.id,
    role: message.info.role,
    text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    files: message.parts.flatMap((part) =>
      part.type === "file"
        ? [
            {
              filename: part.filename,
              mime: part.mime,
              reference: part.id,
              contentReviewed: false,
            },
          ]
        : [],
    ),
    tools: message.parts.flatMap((part) =>
      part.type === "tool"
        ? [
            {
              callID: part.callID,
              tool: part.tool,
              status: part.state.status,
              reference: `${message.info.id}/${part.callID}/result`,
            },
          ]
        : [],
    ),
  }))

const responseText = (message: SessionV1.WithParts) =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

const responseToolResults = (messages: ReadonlyArray<SessionV1.WithParts>) => {
  const latest = messages.findLastIndex(
    (message) => message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
  )
  return messages.slice(latest + 1).flatMap((message) =>
    message.info.role === "assistant"
      ? message.parts.flatMap((part) => {
          if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return []
          return [
            {
              messageID: message.info.id,
              callID: part.callID,
              tool: part.tool,
              status: part.state.status,
              input: Intelligence.evidence(part.state.input, {
                reference: `${message.info.id}/${part.callID}/input`,
                limit: 2000,
              }),
              output: Intelligence.evidence(part.state, {
                reference: `${message.info.id}/${part.callID}/result`,
                limit: 4000,
              }),
            },
          ]
        })
      : [],
  )
}

const attendedClient = SessionStall.attended
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { SessionProcessor } from "./processor"
import { StepBudget } from "./step-budget"
import { AuxDeadline } from "./aux-deadline"
import { SessionGuardLog } from "./guard-log"
import { SessionOrphan } from "./orphan"
import { SessionStall } from "./stall"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@reddb-io/redcode-core/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import {
  Cause,
  DateTime,
  Duration,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  Schedule,
  Scope,
  Context,
  Schema,
  Types,
} from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { MonitorRuntime } from "@/background/monitor"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@reddb-io/redcode-core/database/database"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { eq } from "drizzle-orm"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { ToolSearch } from "./tool-search"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignIdentify } from "@reddb-io/redcode-core/design/identify"
import { DesignProposal } from "@reddb-io/redcode-core/design/proposal"
import { Global } from "@reddb-io/redcode-core/global"
import { LLMEvent } from "@reddb-io/redcode-llm"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { Todo } from "./todo"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { SessionGoal } from "./goal"
import { GoalRuntime } from "./goal-runtime"
import { SessionModelSuggestion } from "./model-suggestion"
import { SessionSpend } from "./spend"
import { SessionBudget } from "./budget"
import { errorMessage } from "@/util/error"
import { Skill } from "@/skill"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const STRUCTURED_OUTPUT_REMINDER = `Your last response was plain text, but structured output was requested. Call the StructuredOutput tool now with your final answer formatted according to the schema.`

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  /**
   * Changes how a prompt that is still waiting reaches the model: a queued prompt becomes a steer
   * (promoted at the next safe boundary) or a steer goes back to the queue. Returns `undefined`
   * when the prompt is not pending in this session (unknown, promoted or removed).
   */
  readonly setDelivery: (input: {
    sessionID: SessionID
    messageID: MessageID
    delivery: SessionInput.Delivery
  }) => Effect.Effect<SessionInput.Admitted | undefined>
  /** The prompts admitted to this session and not yet promoted, oldest first. */
  readonly pending: (sessionID: SessionID) => Effect.Effect<ReadonlyArray<PendingPrompt>>
  /**
   * Discards a prompt that is still waiting, so it is never promoted. Returns `false` when the
   * prompt is not pending in this session (unknown, already promoted or removed).
   */
  readonly discard: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    // The compaction epoch (its summary message id, or "" before the first) in which each
    // unattended session was last asked to wrap up near the context limit.
    const wrapUps = new Map<SessionID, string>()
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const guards = yield* SessionGuardLog.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const design = yield* DesignStudio.Service
    const plans = yield* SessionPlan.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const outputs = yield* ToolOutputBridge.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const context = yield* SessionContext.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const hooks = yield* OperationHookBridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const monitors = yield* MonitorRuntime.Service
    const todos = yield* Todo.Service
    const goals = yield* GoalRuntime.Service
    const suggestions = yield* SessionModelSuggestion.Service
    const spend = yield* SessionSpend.Service
    const limits = yield* ModelLimit.Service
    const intelligence = yield* Intelligence.Service
    const skills = yield* Skill.Service
    // Sessions already told that a provider taught us its limit: the notice shows once.
    const limitNotices = new Set<SessionID>()

    /**
     * What a provider's refusal teaches about its limit. The next request from this model is
     * sized by it, so the refusal does not repeat.
     */
    const learnLimit = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      model: Provider.Model
      error: NonNullable<SessionV1.Assistant["error"]>
      estimate?: number
    }) {
      const data = input.error.data as { message?: unknown; responseBody?: unknown }
      const message = typeof data.message === "string" ? data.message : ""
      const body = typeof data.responseBody === "string" ? data.responseBody : ""
      const numbers = contextOverflowNumbers([message, body].filter(Boolean).join("\n"))
      if (!numbers) return undefined
      const output = ProviderTransform.maxOutputTokens(input.model, flags.outputTokenMax)
      const observed = ModelLimit.fromNumbers({
        numbers,
        output,
        estimated: input.estimate,
        declared: Provider.declaredLimit(yield* config.get(), input.model.providerID, input.model.id),
        message: message || body,
      })
      if (!observed) return undefined
      yield* limits.learn(input.model.providerID, input.model.id, observed)
      yield* Verbose.log("model.limit.learned", {
        sessionID: input.sessionID,
        providerID: input.model.providerID,
        modelID: input.model.id,
        limit: observed.limit,
        from: "provider refusal",
      })
      yield* Effect.logInfo("learned provider input limit", {
        "session.id": input.sessionID,
        providerID: input.model.providerID,
        modelID: input.model.id,
        limit: observed.limit,
        includesOutput: observed.includesOutput ?? false,
        counted: observed.counted,
        estimated: observed.estimated,
        ratio: observed.ratio,
      })
      if (!limitNotices.has(input.sessionID)) {
        limitNotices.add(input.sessionID)
        yield* events
          .publish(TuiEvent.ToastShow, {
            title: "Provider limit learned",
            message: ModelLimit.learnedNotice({
              providerID: input.model.providerID,
              modelID: input.model.id,
              observed,
              output,
            }),
            variant: "info",
            duration: 8_000,
          })
          .pipe(Effect.ignore)
      }
      return observed
    })
    const { db } = database
    // A queued prompt is taken up where the drain it was admitted into would go idle. One still
    // pending when that drain ended was skipped — an Esc, a failed turn, a process that died — and
    // is stale: promoting it at some later idle boundary would put a request the person made long
    // ago after answers they have had since. Stale prompts wait for an explicit send (turning them
    // into a steer) or a discard. Drains are process-local, so is this record: per session, the
    // last admission sequence a finished drain left behind, and anything admitted before this
    // process started, whose drain can only have died with the process that ran it.
    const skippedThrough = new Map<SessionID, number>()
    // The newest queued prompt the running drain's last idle check saw, per session. A drain that
    // ends normally has passed on exactly those; one admitted after that check is not skipped, it
    // joined too late and the next drain takes it up.
    const checkedThrough = new Map<SessionID, number>()
    const startedAt = DateTime.toEpochMillis(yield* DateTime.now)
    const stale = (row: SessionInput.Admitted) =>
      row.delivery === "queue" &&
      (DateTime.toEpochMillis(row.timeCreated) < startedAt ||
        row.admittedSeq <= (skippedThrough.get(row.sessionID) ?? -1))
    // Task review is bookkeeping around a turn. A list the store refuses to reconcile keeps its stored
    // state for this step instead of failing the prompt: it runs before every provider step, so a
    // failure here would fail every prompt in the session.
    const reviewTodos = (sessionID: SessionID) =>
      todos.review(sessionID).pipe(
        Effect.catchTag("SessionTodo.Error", (error) =>
          Effect.logWarning("task review failed; keeping the stored task list", {
            "session.id": sessionID,
            error: error.message,
          }).pipe(Effect.andThen(todos.get(sessionID))),
        ),
      )
    const ops = Effect.fn("SessionPrompt.ops")(function* (sessionID: SessionID) {
      // Cancels seen when this step's tools started. A result arriving after a later cancel (Esc, a
      // stall) stays pending for the person's next message instead of starting a turn on its own.
      const generation = yield* state.generation(sessionID)
      // Decided when the result arrives, not when the monitor started: a goal that is paused, blocked
      // or dropped by then waits for the person, whenever it was set.
      const wake = Effect.gen(function* () {
        if ((yield* state.generation(sessionID)) !== generation) return false
        const goal = yield* goals.get(sessionID)
        return goal === undefined || goal.status === "active" || goal.status === "done"
      })
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
        notify: (input: PromptInput) =>
          Effect.gen(function* () {
            if (input.sessionID !== sessionID) return false
            // Always admitted, never written straight into history, and queued rather than steered:
            // it is promoted only where the session would otherwise go idle, so a result never lands
            // inside a turn the user started, and a parked goal still reads it once it resumes.
            yield* prompt({ ...input, delivery: "queue", noReply: true }).pipe(Effect.orDie)
            if (!(yield* wake)) return true
            yield* Effect.gen(function* () {
              yield* loop({ sessionID })
              // Joining a drain past its last promotion boundary returns without promoting the row
              // admitted above. Wake once more while anything is still pending.
              if (!(yield* wake)) return
              if ((yield* SessionInput.listPending(db, sessionID)).length > 0) yield* loop({ sessionID })
            }).pipe(Effect.forkIn(scope))
            return true
          }),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      yield* state.cancel(sessionID)
      // An interrupted goal waits for the person; it does not pick itself back up.
      yield* goals.pause(sessionID, "interrupted").pipe(Effect.ignore)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      // A configured title model that no longer resolves is not fatal: the session's model can still name it.
      const preferred = ag.model
        ? yield* provider
            .getModel(ag.model.providerID, ag.model.modelID)
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
        : yield* provider.getSmallModel(input.providerID)
      // One attempt with one model. A failed request, a provider error or an answer with no usable
      // line all come back as `undefined`; each attempt's usage is charged by the LLM stream to the
      // model that actually answered.
      const generate = (mdl: Provider.Model) =>
        Effect.gen(function* () {
          const msgs = onlySubtasks
            ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
            : yield* MessageV2.toModelMessagesEffect(context, mdl)
          const events = Array.from(
            yield* llm
              .stream({
                agent: ag,
                user: firstInfo,
                system: [],
                small: true,
                tools: {},
                model: mdl,
                sessionID: input.session.id,
                retries: 2,
                messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
              })
              .pipe(Stream.runCollect),
          )
          if (events.some(LLMEvent.is.providerError)) return undefined
          return events
            .filter(LLMEvent.is.textDelta)
            .map((event) => event.text)
            .join("")
            .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0)
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("title generation failed", {
              "session.id": input.session.id,
              providerID: mdl.providerID,
              modelID: mdl.id,
              error: error instanceof Error ? error.message : String(error),
            }).pipe(Effect.as(undefined)),
          ),
        )
      const titleMs = AuxDeadline.deadlineMs("title", (yield* config.get()).experimental?.aux_timeout)
      const cleaned = yield* Effect.gen(function* () {
        const first = preferred ? yield* generate(preferred) : undefined
        if (first) return first
        const primary = yield* provider.getModel(input.providerID, input.modelID)
        if (!preferred) return yield* generate(primary)
        if (preferred.providerID === primary.providerID && preferred.id === primary.id) return undefined
        // The title model failed or answered with nothing usable; the session's own model gets one try.
        yield* Effect.logInfo("title model failed, retrying with the session model", {
          "session.id": input.session.id,
          providerID: preferred.providerID,
          modelID: preferred.id,
        })
        return yield* generate(primary)
      }).pipe(
        // Naming the session happens inside the turn loop, so a small model that stops answering
        // holds up the work the user actually asked for. A session keeping its default name is a
        // far smaller loss than a turn that never starts. The deadline covers both attempts.
        titleMs === undefined
          ? (self) => self
          : Effect.timeoutOrElse({
              duration: Duration.millis(titleMs),
              orElse: () =>
                Effect.gen(function* () {
                  yield* guards.record({
                    sessionID: input.session.id,
                    guard: "aux",
                    action: "stop",
                    subject: "title",
                    detail: AuxDeadline.message("title", titleMs),
                  })
                  yield* Effect.logWarning(AuxDeadline.message("title", titleMs), {
                    "session.id": input.session.id,
                  })
                  return undefined
                }),
            }),
      )
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops(sessionID)
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }
    })

    /** One nudge for the whole batch: the outputs sit above, the model picks the thread back up. */
    const summarizeSubtasks = Effect.fn("SessionPrompt.summarizeSubtasks")(function* (input: {
      lastUser: SessionV1.User
      sessionID: SessionID
    }) {
      const { lastUser, sessionID } = input
      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false
          let published = ""
          let publishedAt = 0

          const publishProgress = Effect.fnUntraced(function* (force = false) {
            if (part.state.status !== "running" || output === published) return
            if (!force && published && Date.now() - publishedAt < 100) return
            part.state.metadata = { output }
            yield* sessions.updatePart(part)
            published = output
            publishedAt = Date.now()
          })

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  yield* publishProgress()
                }),
              )
              yield* publishProgress(true)
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      // Transient provider-catalog failures (network, models.dev fetch) must not kill the turn: a
      // couple of short retries ride the blip out, and the provider's typed not-found is never
      // retried. A failure that survives publishes the provider's message as a session error, so
      // the person sees the real cause instead of an opaque defect.
      const attempt = () => provider.getModel(providerID, modelID).pipe(Effect.exit)
      let exit = yield* attempt()
      for (let retries = 2; Exit.isFailure(exit); retries--) {
        const candidate = Cause.squash(exit.cause)
        if (Provider.ModelNotFoundError.isInstance(candidate)) break
        if (Cause.hasInterrupts(exit.cause) || retries <= 0) break
        yield* Effect.sleep(250)
        exit = yield* attempt()
      }
      // A fallback combo's member other than its lead that served the session is planned for.
      if (Exit.isSuccess(exit)) return ComboMember.model(sessionID, exit.value)
      const err = Cause.squash(exit.cause)
      const message = Provider.ModelNotFoundError.isInstance(err) ? err.message : errorMessage(err)
      yield* events
        .publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({ message }).toObject(),
        })
        .pipe(Effect.ignore)
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      const settings = yield* intelligence.read().pipe(Effect.orDie)
      if (settings.principal)
        return {
          providerID: ProviderV2.ID.make(settings.principal.providerID),
          modelID: ModelV2.ID.make(settings.principal.id),
          ...(settings.principal.variant ? { variant: settings.principal.variant } : {}),
        }
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      // A prompt that names no agent continues the conversation it lands in: the agent of the
      // last user message, not the default. Callers that inject messages — design feedback from
      // the browser, orphan recovery, plugins — must not flip a plan or design session to build.
      const agentName =
        input.agent ??
        (yield* sessions
          .findMessage(input.sessionID, (m) => m.info.role === "user" && !!m.info.agent)
          .pipe(
            Effect.map((match) =>
              Option.isSome(match) && match.value.info.role === "user" ? match.value.info.agent : undefined,
            ),
            Effect.orElseSucceed(() => undefined),
          ))
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      // An agent's `auto` needs a model with effort levels to choose between.
      const agentVariant =
        ag.variant === ReasoningAuto.AUTO
          ? ReasoningAuto.supports(Object.keys(full?.variants ?? {}))
          : !!ag.variant && !!full?.variants?.[ag.variant]
      const variant =
        input.variant ??
        (agentVariant ? ag.variant : undefined) ??
        ("variant" in model && typeof model.variant === "string" ? model.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (
        current.agent !== info.agent ||
        current.model?.providerID !== info.model.providerID ||
        current.model?.id !== info.model.modelID ||
        (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant
      ) {
        yield* sessions.setAgentModel({
          sessionID: input.sessionID,
          agent: info.agent,
          model: {
            id: info.model.modelID,
            providerID: info.model.providerID,
            variant: info.model.variant ?? "default",
          },
          time: info.time.created,
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      // Admitted before the message rows exist, so the message is never model-visible ahead of
      // its Prompt Promotion: the loop republishes it at the next safe boundary with a commit
      // hook that stamps the inbox row. The row is a sidecar next to the V1 message rather than
      // a V2 user row (which the `Prompted` projector would create).
      const files = parts.flatMap((part) =>
        part.type === "file"
          ? [{ uri: part.url, mime: part.mime, ...(part.filename ? { name: part.filename } : {}) }]
          : [],
      )
      const mentions = parts.flatMap((part) => (part.type === "agent" ? [{ name: part.name }] : []))
      const prompt = Prompt.fromUserMessage({
        text: parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
        ...(files.length > 0 ? { files } : {}),
        ...(mentions.length > 0 ? { agents: mentions } : {}),
      })
      const delivery = input.delivery ?? "steer"
      const earlier = yield* readmission({ sessionID: input.sessionID, messageID: input.messageID, prompt, delivery })
      if (earlier) return earlier
      yield* SessionInput.admit(db, events, {
        id: SessionMessage.ID.make(info.id),
        sessionID: input.sessionID,
        prompt,
        delivery,
      })
      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    // The stored message a prompt is a second copy of, returned instead of admitting it again.
    //
    // A prompt that names an ID already admitted is a retry. An exact one (same Session, prompt and
    // delivery) gets the stored message back untouched: writing its rows again would re-stamp a
    // promoted message to now, moving it to the end of history where the model reads it as the
    // person asking a second time. A reuse that differs is refused.
    //
    // A prompt without an ID that repeats one still waiting in the inbox is the same request sent
    // again: after a send the client reported as failed although the server had admitted it, or
    // to get a queued prompt taken up sooner. A second row would be promoted at its own idle
    // boundary, often long after the first one was answered. The waiting row stands for both, and
    // a steer moves it ahead of the queue. Callers that need distinct inputs name their IDs.
    const readmission = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID?: MessageID
      prompt: Prompt
      delivery: SessionInput.Delivery
    }) {
      if (input.messageID !== undefined) {
        const admitted = yield* SessionInput.find(db, SessionMessage.ID.make(input.messageID))
        if (admitted === undefined) return undefined
        if (!SessionInput.equivalent(admitted, input))
          return yield* Effect.die(new SessionInput.LifecycleConflict({ id: admitted.id }))
        // Admitted but its rows never written: the retry writes them.
        return yield* storedUserMessage(input.sessionID, input.messageID)
      }
      // A stale row is not the request being repeated: sending it again is a new request.
      const waiting = (yield* SessionInput.listPending(db, input.sessionID)).find(
        (row) => !stale(row) && SessionInput.matchesPrompt(row, input),
      )
      if (waiting === undefined) return undefined
      const stored = yield* storedUserMessage(input.sessionID, MessageID.make(waiting.id))
      if (stored === undefined) return undefined
      // Promoted in the meantime is fine too: the request is being delivered either way.
      if (input.delivery === "steer" && waiting.delivery === "queue")
        yield* SessionInput.setDelivery(db, events, { sessionID: input.sessionID, id: waiting.id, delivery: "steer" })
      yield* Effect.logInfo("prompt repeats one still pending; kept the admitted one", {
        "session.id": input.sessionID,
        messageID: waiting.id,
        delivery: input.delivery,
      })
      return stored
    })

    const storedUserMessage = (sessionID: SessionID, messageID: MessageID) =>
      MessageV2.get({ sessionID, messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.option,
        Effect.map((message) =>
          Option.isSome(message) && message.value.info.role === "user" ? message.value : undefined,
        ),
      )

    // Prompt Promotion for a V1 session. The stored user message is published again, re-stamped
    // to now (history is ordered by creation time, and an admitted prompt is older than everything
    // the drain wrote since), and then `message.promoted` records the promotion as a durable event
    // the projector stamps on the inbox row — explicit, so a retried `message.updated` promotes
    // nothing, and replayed, so a synced or stolen session comes back with its rows stamped.
    //
    // A row without a stored user message is skipped, never removed: admission and the message
    // rows are separate publications a boundary can fall between, and on a replica rebuilding its
    // projection every row is "old" while its `message.updated` may still be on its way, so any
    // removal here would be a durable mistake. Skipping is enough — the queue takes the first
    // promotable row past it — and nothing has to re-wake the drain for a skipped row: the request
    // that admitted it calls `loop` once its rows are written, and that call is the wake. Only
    // `message.removed` (revert) drops a pending row. Up to `limit` rows promote.
    const promote = Effect.fnUntraced(function* (
      sessionID: SessionID,
      rows: ReadonlyArray<SessionInput.Admitted>,
      limit = rows.length,
    ) {
      let promoted = 0
      for (const row of rows) {
        if (promoted >= limit) break
        const messageID = MessageID.make(row.id)
        const message = yield* MessageV2.get({ sessionID, messageID }).pipe(
          Effect.provideService(Database.Service, database),
          Effect.option,
        )
        const now = yield* DateTime.now
        if (Option.isNone(message)) {
          yield* Effect.logDebug("admitted prompt has no stored user message yet; skipped", {
            "session.id": sessionID,
            messageID,
          })
          continue
        }
        if (message.value.info.role !== "user") {
          yield* Effect.logWarning("admitted prompt is not a user message; left pending", {
            "session.id": sessionID,
            messageID,
          })
          continue
        }
        const info: SessionV1.User = {
          ...message.value.info,
          time: { ...message.value.info.time, created: DateTime.toEpochMillis(now) },
        }
        yield* sessions.updateMessage(info)
        yield* events.publish(SessionV1.Event.MessagePromoted, { sessionID, messageID })
        yield* Verbose.log("inbox.promoted", { sessionID, messageID, delivery: row.delivery })
        promoted++
      }
      return promoted
    })

    // The boundary where the session would otherwise go idle: every steer still pending comes
    // first, then exactly one queued prompt that is not stale. Returns whether the drain has new work.
    const promoteAtIdle = Effect.fn("SessionPrompt.promoteAtIdle")(function* (sessionID: SessionID) {
      const steers = yield* SessionInput.listPending(db, sessionID, { delivery: "steer" })
      if ((yield* promote(sessionID, steers)) > 0) return true
      const queued = yield* SessionInput.listPending(db, sessionID, { delivery: "queue" })
      const newest = queued.at(-1)
      if (newest) checkedThrough.set(sessionID, newest.admittedSeq)
      const fresh = queued.filter((row) => !stale(row))
      return (yield* promote(sessionID, fresh, 1)) > 0
    })

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const reportIntelligenceFailure = (sessionID: SessionID, operation: string, message: string) =>
      Effect.gen(function* () {
        const detail = `System One ${operation} unavailable: ${message}. Completion has not been verified.`
        yield* guards.record({ sessionID, guard: "intelligence", action: "warn", detail })
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({ message: detail }).toObject(),
        })
      })

    const requireModels = (sessionID: SessionID) =>
      intelligence.read().pipe(
        Effect.flatMap(Intelligence.requireConfigured),
        Effect.tapError((error) =>
          events.publish(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({ message: error.message }).toObject(),
          }),
        ),
        Effect.orDie,
      )

    /** User messages whose design-system identification was already started in the background. */
    const warmed = new Set<string>()
    /**
     * Identifies the design system in the background once the design agent runs or System One routes a
     * message as design, so design_document create finds the result cached instead of waiting for S1.
     */
    const warmDesignSystem = (sessionID: SessionID, directory: string) =>
      Effect.gen(function* () {
        const global = Global.make()
        const design = yield* Effect.promise(() =>
          DesignProposal.configured(directory, global.config).catch(() => undefined),
        )
        if (design?.system && !(yield* Effect.promise(() => DesignProposal.stale(directory, design).catch(() => true))))
          return
        yield* DesignIdentify.warm({
          directory,
          application: design?.application,
          state: path.join(global.state, DesignIdentify.STATE),
          mode: Intelligence.mode(yield* intelligence.read().pipe(Effect.orElseSucceed(() => Intelligence.defaults))),
          sessionID,
          evaluate: (evaluation) => intelligence.evaluate(evaluation),
        })
      })

    const evaluateIntelligence = Effect.fn("SessionPrompt.evaluateIntelligence")(function* (
      input: Intelligence.EvaluationInput,
      attempts?: Map<string, Intelligence.Evaluation | undefined>,
    ) {
      const settings = yield* intelligence.read()
      yield* Intelligence.requireConfigured(settings)
      // Single reasoning runs S2 alone: no classification, review or warning is produced.
      if (Intelligence.mode(settings) === "single") return undefined
      const hash = Intelligence.evaluationFingerprint(input, settings)
      if (attempts?.has(hash)) {
        const cached = attempts.get(hash)
        yield* Effect.logInfo("Reusing System One evaluation", {
          sessionID: input.sessionID,
          operation: input.operation,
          evaluationID: cached?.id,
          decision: cached?.decision ?? "unavailable",
          source: "drain",
        })
        return cached
      }
      const previous = (yield* intelligence
        .history(input.sessionID, {
          operation: input.operation,
          subjectID: input.subjectID,
          candidateID: input.candidateID,
          limit: 1,
        })
        .pipe(Effect.orElseSucceed(() => [])))[0]
      if (
        previous?.fingerprint === hash &&
        previous.decision !== "unavailable" &&
        previous.decision !== "inconclusive"
      ) {
        attempts?.set(hash, previous)
        yield* Effect.logInfo("Reusing System One evaluation", {
          sessionID: input.sessionID,
          operation: input.operation,
          evaluationID: previous.id,
          decision: previous.decision,
          source: "history",
        })
        return previous
      }
      const evaluation = yield* intelligence
        .evaluate(input)
        .pipe(
          Effect.catchTag("IntelligenceError", (error) =>
            reportIntelligenceFailure(SessionID.make(input.sessionID), input.operation, error.message).pipe(
              Effect.as(undefined),
            ),
          ),
        )
      attempts?.set(evaluation?.fingerprint ?? hash, evaluation)
      return evaluation
    })

    const reviewResponse = Effect.fn("SessionPrompt.reviewResponse")(function* (
      sessionID: SessionID,
      messages: ReadonlyArray<SessionV1.WithParts>,
      candidate: SessionV1.WithParts,
      attempt: number,
    ) {
      const text = responseText(candidate)
      if (!text.trim()) return undefined
      const requests = messages.flatMap((message) => {
        if (message.info.role !== "user" || message.parts.every((part) => "synthetic" in part && part.synthetic))
          return []
        return [
          {
            id: message.info.id,
            text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
          },
        ]
      })
      const toolResults = responseToolResults(messages)
      const tasks = yield* todos.get(sessionID)
      const goal = yield* goals.get(sessionID)
      const request = requests.at(-1)?.id
      const classification = request
        ? (yield* intelligence
            .history(sessionID, { operation: "prompt_classification", subjectID: request, limit: 1 })
            .pipe(Effect.orElseSucceed(() => [])))[0]
        : undefined
      const questions = Intelligence.responseQuestionsFor({
        tools: toolResults.length > 0,
        tasks: tasks.length > 0,
        goal: goal?.status === "active",
        route: Intelligence.workRoute(classification),
      })
      if (!questions) return undefined
      return yield* evaluateIntelligence({
        sessionID,
        operation: "response_quality",
        kind: "gate",
        subjectID: requests.at(-1)?.id,
        candidateID: candidate.info.id,
        attempt,
        sources: {
          requests: Intelligence.evidence(requests, { reference: `${sessionID}/requests`, limit: 3000 }),
          latest_request: Intelligence.evidence(requests.at(-1), { reference: requests.at(-1)?.id, limit: 4000 }),
          tasks: Intelligence.evidence(tasks, { reference: `${sessionID}/tasks`, limit: 3000 }),
          goal: Intelligence.evidence(goal, { reference: `${sessionID}/goal`, limit: 2000 }),
          tool_results: Intelligence.evidence(toolResults, { reference: `${sessionID}/tool-results`, limit: 8000 }),
        },
        candidate: Intelligence.evidence(text, { reference: candidate.info.id, limit: 6000 }),
        questions,
      }).pipe(
        Effect.catchTag("IntelligenceError", (error) =>
          reportIntelligenceFailure(sessionID, "response_quality", error.message).pipe(Effect.as(undefined)),
        ),
      )
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        yield* requireModels(sessionID)
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        let todoContinuations = 0
        let reconnects = 0
        let responseRepairs = 0
        // The issues repaired this turn and the response the last repair revised: an issue is
        // repaired once, and a revision that changes nothing material ends the repairs.
        let repairedIssues: ReadonlyArray<string> = []
        let repairedResponse: string | undefined
        // Reminders sent to a model that cannot be forced to call StructuredOutput and answered in text.
        let structuredReminders = 0
        const promptAssessments = new Map<string, Intelligence.Evaluation | undefined>()
        const intelligenceAttempts = new Map<string, Intelligence.Evaluation | undefined>()
        const toolAssessments = new Map<string, Intelligence.Evaluation | undefined>()
        // The task list as reviewed since the last provider turn. A continuation reads it to decide
        // whether to keep going; the step it starts reuses that read instead of reviewing again.
        let reviewed: ReadonlyArray<Todo.Info> | undefined
        // Whether this drain has sent anything to the provider. A drain that finds the previous
        // turn already finished (a wake, or a queued prompt on an idle session) has no turn of its
        // own to review or judge; it only promotes what is waiting.
        let ran = false
        // Automatic compactions in a row this turn that did not free enough room (one that did
        // resets it: long work that keeps compacting effectively is never capped), and what the
        // last step carried besides history, which every request after a compaction carries again.
        let ineffectiveCompactions = 0
        let overhead = 0
        // The last request's system prompt and tools, which a cached summary request repeats, and
        // the finished step whose context trimming old tool output already brought under the band.
        let lastRequest: SessionCompaction.ProcessInput["request"]
        let relieved: string | undefined
        // The last request this drain sent and our estimate for it, matched with the provider's
        // count for it once the step finishes, so the next request is projected from that count.
        let lastSent: { messageID: MessageID; estimate: number } | undefined
        // Recoveries this turn from a request that would not, or did not, fit the provider's
        // limit. Bounded: after them the request is refused with what to do about it.
        let overflowRecoveries = 0
        // The stop-loss's checkpoints this turn: when the last one was and how many hints it gave.
        let stopLoss = SessionStopLoss.FRESH
        const measured = (effective: boolean) => {
          ineffectiveCompactions = effective ? 0 : ineffectiveCompactions + 1
        }
        // A promoted prompt starts a fresh turn: the provider-turn allowance is reset once for the
        // batch, and with it the continuation budget that rides on it.
        const restart = () => {
          step = 0
          todoContinuations = 0
          reconnects = 0
          responseRepairs = 0
          repairedIssues = []
          repairedResponse = undefined
          structuredReminders = 0
          reviewed = undefined
          ineffectiveCompactions = 0
          overflowRecoveries = 0
          stopLoss = SessionStopLoss.FRESH
        }
        // The turn ends here: nothing we can send fits the provider, and compacting again would
        // only repeat the last attempt.
        const refuseOversized = Effect.fnUntraced(function* (input: {
          message: SessionV1.Assistant
          model: Provider.Model
          projected: number
        }) {
          const limit = hardLimit({ model: input.model, outputTokenMax: flags.outputTokenMax })
          const text = ModelLimit.doomed({
            providerID: input.model.providerID,
            limit,
            estimated: input.projected,
          })
          input.message.error = new SessionV1.ContextOverflowError({ message: text }).toObject()
          input.message.finish = "error"
          input.message.time.completed = Date.now()
          yield* sessions.updateMessage(input.message)
          yield* guards.record({ sessionID, guard: "compaction", action: "stop", detail: text })
          yield* Effect.logWarning("request refused before sending; it would exceed the provider limit", {
            "session.id": sessionID,
            limit,
            projected: input.projected,
            recoveries: overflowRecoveries,
          })
          yield* goals.pause(sessionID, `${CompactionGuard.COMPACTION_GUARD_PAUSE}${text}`).pipe(Effect.ignore)
          yield* events.publish(Session.Event.Error, { sessionID, error: input.message.error })
          yield* events
            .publish(TuiEvent.ToastShow, {
              title: "Request too large",
              message: text,
              variant: "warning",
              duration: 10_000,
            })
            .pipe(Effect.ignore)
        })
        // Why automatic compaction may not run now, if it may not.
        const compactionHold = Effect.fnUntraced(function* (history: SessionV1.WithParts[]) {
          const current = yield* sessions.get(sessionID).pipe(Effect.orDie)
          const latest = history.findLast(SessionCompaction.isRealRequest)?.info.id
          if (CompactionGuard.isPaused(CompactionGuard.fromMetadata(current.metadata), latest)) return "paused" as const
          if (ineffectiveCompactions >= CompactionGuard.MAX_AUTO_PER_TURN) return "limit" as const
          return undefined
        })
        // One notice, then the turn ends: compacting again would only repeat the last attempt. A
        // warning, not an error: nothing failed, and the notice says what to do.
        const stopCompacting = Effect.fnUntraced(function* (hold: "paused" | "limit") {
          const text = hold === "paused" ? CompactionGuard.PAUSED : CompactionGuard.LIMIT
          yield* guards.record({ sessionID, guard: "compaction", action: "stop", detail: text })
          yield* Effect.logWarning("automatic compaction held back; ending the turn", {
            "session.id": sessionID,
            hold,
            ineffective: ineffectiveCompactions,
          })
          yield* goals.pause(sessionID, CompactionGuard.goalReason(hold)).pipe(Effect.ignore)
          yield* events
            .publish(TuiEvent.ToastShow, {
              title: CompactionGuard.NOTICE_TITLE,
              message: text,
              variant: "warning",
              duration: 10_000,
            })
            .pipe(Effect.ignore)
        })
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        // What the session shows about its automatic effort (ReasoningAuto), written only on change.
        let shownEffort = JSON.stringify(session.metadata?.reasoning ?? null)
        const showEffort = Effect.fnUntraced(function* () {
          const state = ReasoningAuto.recall(sessionID)
          if (!state) return
          const shown = ReasoningAuto.display(state)
          if (JSON.stringify(shown) === shownEffort) return
          shownEffort = JSON.stringify(shown)
          yield* sessions.updateMetadata(sessionID, (metadata) => ({ ...metadata, reasoning: shown }))
        })
        // The stop-loss, at the boundary after a step the model continues from: is the turn still
        // getting anywhere for what it spends? True when it ended the turn. See SessionStopLoss.
        const checkStopLoss = Effect.fnUntraced(function* (input: {
          /** The turn's step that just finished; the window read back may not reach its start. */
          step: number
          lastUser: SessionV1.User
          agent: Agent.Info
          model: Provider.Model
        }) {
          const experimental = (yield* config.get()).experimental
          const bounds = SessionStopLoss.limits(experimental?.stop_loss, LoopGuard.limits(experimental?.loop_guard))
          if (!bounds) return false
          const turn = SessionStopLoss.legacy(
            yield* sessions.messages({ sessionID, limit: STOP_LOSS_WINDOW }).pipe(Effect.orElseSucceed(() => [])),
          )
          const trajectory = SessionStopLoss.observe(turn.steps, { now: Date.now(), started: turn.started })
          const found = SessionStopLoss.signals(trajectory, bounds)
          const subagent = session.parentID !== undefined
          // A read-only subagent keeps the mechanical rules but costs no S1 checkpoints.
          const readOnly = SubagentReview.fromMetadata(session.metadata)?.writeCapable === false
          const settings = yield* intelligence.read().pipe(Effect.orElseSucceed(() => undefined))
          const asked = !!settings && Intelligence.mode(settings) === "dual" && !readOnly
          const step = input.step
          const memory = SessionStopLoss.current(stopLoss, step, trajectory.idle)
          const checkpoint = SessionStopLoss.due({ step, memory, limits: bounds, signals: found, interval: asked })
          if (checkpoint.type === "none") return false
          const started = Date.now()
          const evaluation = asked
            ? yield* evaluateIntelligence(
                SessionStopLoss.evaluation({
                  sessionID,
                  request: turn.request,
                  steps: turn.steps,
                  trajectory,
                  checkpoint,
                  subagent,
                  directory: ctx.directory,
                  limits: bounds,
                }),
                intelligenceAttempts,
              ).pipe(Effect.orElseSucceed(() => undefined))
            : undefined
          // A checkpoint reused from the cache was paid for when it was made.
          if (evaluation && evaluation.created >= started)
            yield* spend.recordEvaluation({ sessionID, usage: evaluation.usage })
          const verdict = SessionStopLoss.decide({
            trajectory,
            limits: bounds,
            memory,
            asked,
            evaluation,
            subagent,
          })
          stopLoss = SessionStopLoss.remember(memory, step, verdict)
          if (verdict.action === "continue") return false
          const notice = { [SessionStopLoss.METADATA_KEY]: SessionStopLoss.notice(trajectory, verdict, { subagent }) }
          yield* guards.record({
            sessionID,
            guard: "stop_loss",
            action: verdict.action === "steer" ? "correct" : "stop",
            subject: checkpoint.type === "signal" ? checkpoint.signals.join(",") : "interval",
            detail: SessionStopLoss.detail(trajectory, verdict),
          })
          // Kept on the session too, so a parent's task row and the sidebar show where the checkpoints
          // left a subagent without loading its messages.
          const kept: SubagentView.Checkpoint = {
            action: verdict.action,
            line: SessionStopLoss.line(trajectory, verdict, { subagent }),
            ...(verdict.action === "steer" ? {} : { reason: SessionStopLoss.reason(trajectory, verdict) }),
            at: Date.now(),
          }
          yield* sessions.updateMetadata(sessionID, (metadata) => SubagentView.withCheckpoint(metadata, kept))
          yield* Effect.logWarning("stop-loss acted on a turn without progress", {
            "session.id": sessionID,
            action: verdict.action,
            verified: verdict.verified,
            idle: trajectory.idle,
          })
          if (verdict.action === "steer") {
            const message: SessionV1.User = {
              id: MessageID.ascending(),
              sessionID,
              role: "user",
              time: { created: Date.now() },
              agent: input.lastUser.agent,
              model: input.lastUser.model,
            }
            yield* sessions.updateMessage(message)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID,
              messageID: message.id,
              type: "text",
              // Legacy bash can wait on a status check in the background (its `monitor` parameter).
              text: SessionStopLoss.steer(trajectory, verdict, { monitor: true }),
              synthetic: true,
              metadata: notice,
            })
            return false
          }
          // The turn ends on a message of its own: the question for the user, or the account of what
          // was spent and why. A subagent's becomes the result its parent reads.
          const now = Date.now()
          const message: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: input.lastUser.id,
            role: "assistant",
            mode: input.agent.name,
            agent: input.agent.name,
            variant: input.lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: input.model.id,
            providerID: input.model.providerID,
            time: { created: now, completed: now },
            finish: "stop",
            sessionID,
          }
          yield* sessions.updateMessage(message)
          yield* sessions.updatePart({
            id: PartID.ascending(),
            sessionID,
            messageID: message.id,
            type: "text",
            text: SessionStopLoss.final(trajectory, verdict, { subagent, monitor: true }),
            synthetic: true,
            metadata: notice,
          })
          yield* goals
            .pause(sessionID, `${SessionStopLoss.PAUSE}${SessionStopLoss.reason(trajectory, verdict)}`)
            .pipe(Effect.ignore)
          return true
        })
        // A goal never restarts itself: if the process that drove it is not this one, it is
        // paused here, and only /goal resume brings it back.
        {
          const goal = SessionGoal.fromMetadata(session.metadata)
          if (goal?.status === "active" && goal.boot !== undefined && goal.boot !== SessionGoal.BOOT) {
            yield* goals.pause(sessionID, "the session was resumed in a new process").pipe(Effect.ignore)
          }
        }

        // Only one run exists per session at a time, so an assistant message still open here was
        // left by a run that is gone — a process that died before it could close it. Left alone it
        // reads as a turn in progress for the rest of the session's life, and everything typed
        // after it is stamped QUEUED, across restarts, with nothing running.
        const history = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
          Effect.provideService(Database.Service, database),
        )
        const abandoned = SessionOrphan.orphans(history)
        for (const message of abandoned) {
          message.error ??= new SessionV1.AbortedError({ message: SessionOrphan.ORPHAN_MESSAGE }).toObject()
          message.time.completed = Date.now()
          yield* sessions.updateMessage(message).pipe(Effect.ignore)
          const item = history.find((entry) => entry.info.id === message.id)
          for (const part of item ? SessionOrphan.unfinishedTools(item) : [])
            yield* sessions.updatePart(part).pipe(Effect.ignore)
          yield* guards.record({
            sessionID,
            guard: "orphan",
            action: "stop",
            detail: SessionOrphan.ORPHAN_MESSAGE,
          })
        }
        if (abandoned.length > 0) {
          yield* Effect.logWarning("closed turns left behind by a process that died", {
            "session.id": sessionID,
            count: abandoned.length,
          })
        }

        // Turn lifecycle: fire `Turn.Started` once per turn (before any step).
        const turnStarted = { sessionID, timestamp: yield* DateTime.now }
        yield* hooks.parallel(OperationHook.Operation.Turn.Started, turnStarted)
        yield* events.publish(SessionEvent.Turn.Started, turnStarted).pipe(Effect.ignore)

        // A turn that goes quiet used to leave no trace at all: no event, no log, and a spinner
        // indistinguishable from progress. This watches for that, says so, and — where nobody is
        // sitting in front of it — ends the turn rather than letting it burn.
        //
        // One fiber for the whole turn, reading whichever step's handle is current. Forked as a
        // child of this fiber, so it dies when the turn does: `scope` above belongs to the service
        // layer and outlives every turn, which would leave a poller behind per step.
        let watched: SessionProcessor.Handle | undefined
        let warned = false
        yield* Effect.forkChild(
          Effect.forever(
            Effect.suspend(() =>
              Effect.gen(function* () {
                const handle = watched
                if (!handle) {
                  // Before the first step has a handle there is nothing to measure, and the
                  // configured cadence has not been read yet. Look again shortly rather than
                  // sleeping a full interval and missing the start of the turn.
                  yield* Effect.sleep(Duration.millis(SessionStall.POLL_MIN_MS))
                  return
                }
                // Read on first use rather than before the loop: the turn's opening is a
                // cancellation-sensitive stretch and this has no business being on it.
                const limits = SessionStall.limits((yield* config.get()).experimental?.turn_stall, {
                  // A person watching can read the warning and press escape; a scripted run, an
                  // editor speaking ACP or a scheduled job cannot.
                  attended: attendedClient(flags.client),
                })
                const pending = yield* permission.list()
                const decision = SessionStall.decide({
                  quietMs: Date.now() - handle.lastEventAt,
                  activeToolCount: handle.activeToolCount,
                  permissionPending: pending.some((item) => item.sessionID === sessionID),
                  limits,
                })
                const nap = Effect.sleep(Duration.millis(SessionStall.pollMs(limits)))
                if (decision.type === "working") {
                  warned = false
                  yield* nap
                  return
                }
                if (decision.type === "warn") {
                  // Said once per quiet stretch, not on every poll.
                  if (!warned) {
                    warned = true
                    yield* guards.record({
                      sessionID,
                      guard: "stall",
                      action: "warn",
                      detail: SessionStall.warning(decision.quietMs, limits),
                    })
                    yield* Effect.logWarning(SessionStall.warning(decision.quietMs, limits), {
                      "session.id": sessionID,
                      messageID: handle.message.id,
                    })
                  }
                  yield* nap
                  return
                }
                yield* guards.record({
                  sessionID,
                  guard: "stall",
                  action: "stop",
                  detail: `stopped: ${decision.reason}`,
                })
                yield* Effect.logWarning("ending a turn that stopped producing output", {
                  "session.id": sessionID,
                  messageID: handle.message.id,
                  reason: decision.reason,
                })
                // The reason has to be written before the interrupt lands: every later writer on
                // the abort path guards with `??=`, so whoever gets there first decides what the
                // message says, and otherwise this reads as an ordinary user interrupt.
                handle.message.error ??= new SessionV1.AbortedError({
                  message: `stopped: ${decision.reason}`,
                }).toObject()
                yield* sessions.updateMessage(handle.message).pipe(Effect.ignore)
                // Paused here, with the stall as the reason, before the interrupt lands: this path
                // bypasses `SessionPrompt.cancel`, so an active goal used to survive the stop and
                // sit active on an idle session with nothing recorded.
                yield* goals.pause(sessionID, `stalled: ${decision.reason}`).pipe(Effect.ignore)
                // Detached deliberately: cancel interrupts this very fiber partway through, and
                // the part that returns the session to idle runs after that point.
                yield* state.cancel(sessionID).pipe(Effect.ignore, Effect.forkIn(scope))
              }),
            ),
          ),
        )

        while (true) {
          yield* requireModels(sessionID)
          // Safe boundary: steers admitted up to here become visible together, and a promotion
          // starts the step allowance over once for the batch. Anything admitted from now on
          // waits for the next boundary rather than landing in the middle of a provider turn.
          const cutoff = yield* EventV2.latestSequence(db, sessionID)
          const steers = yield* SessionInput.listPending(db, sessionID, { delivery: "steer", cutoffSeq: cutoff })
          if ((yield* promote(sessionID, steers)) > 0) restart()

          yield* status.set(sessionID, { type: "busy", phase: "preparing", step: step + 1, since: Date.now() })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })

          // A ceiling the model cannot talk its way past. `agent.steps` only appends a prompt
          // asking it to stop, which a model that has stopped making progress ignores — and
          // then the turn runs until someone notices the spend. Cutting the turn off at the wall
          // also throws away everything worked out but not yet written down, so the last steps
          // before it are spent asking for that instead.
          const budget = StepBudget.decide({
            // `step` counts steps already finished, so this is the one about to run.
            step: step + 1,
            limits: StepBudget.limits((yield* config.get()).experimental?.turn_steps),
          })
          if (budget.type === "stop") {
            yield* guards.record({ sessionID, guard: "steps", action: "stop", detail: budget.message })
            yield* Effect.logWarning("turn exceeded the step ceiling", {
              "session.id": sessionID,
              steps: step,
            })
            // The turn ends before `afterTurn` is reached, so the goal has to be parked here or it
            // stays active on an idle session.
            yield* goals
              .pause(sessionID, `stopped at the step ceiling after ${step} steps; /goal resume starts a fresh turn`)
              .pipe(Effect.ignore)
            yield* events.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: budget.message }).toObject(),
            })
            // The stopped turn is over; a prompt waiting for idle starts its own turn here.
            if (yield* promoteAtIdle(sessionID)) {
              restart()
              continue
            }
            break
          }
          if (budget.type === "wrap-up") {
            yield* guards.record({
              sessionID,
              guard: "steps",
              action: "correct",
              subject: `step ${step + 1}`,
              detail: `asked for a final report with ${budget.remaining} steps left before the ceiling`,
            })
            yield* Effect.logWarning("turn is near the step ceiling; asking for a final report", {
              "session.id": sessionID,
              steps: step,
              remaining: budget.remaining,
            })
          }

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )
          // An Admitted Prompt is stored (the TUI shows it as queued) but not yet model-visible.
          const admitted = new Set<string>((yield* SessionInput.listPending(db, sessionID)).map((row) => row.id))
          if (admitted.size > 0) msgs = msgs.filter((msg) => !admitted.has(msg.info.id))

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) {
            if (yield* promoteAtIdle(sessionID)) {
              restart()
              continue
            }
            yield* Effect.logWarning("no visible user message and nothing admitted", { "session.id": sessionID })
            break
          }

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          if (
            lastAssistant?.finish &&
            !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastAssistant.parentID === lastUser.id
          ) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
                "session.id": sessionID,
                messageID: lastAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
              if (yield* promoteAtIdle(sessionID)) {
                restart()
                continue
              }
              break
            }
            // Nothing was sent to the provider by this drain: the finished turn it found was
            // reviewed and judged by the drain that ran it. Only promotion is left to do.
            if (!ran) {
              if (yield* promoteAtIdle(sessionID)) {
                restart()
                continue
              }
              yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
              break
            }
            // Waiting is a scheduler boundary: neither the todo nudger nor the goal judge
            // should spend provider calls while an external observation is outstanding.
            // The session still goes idle through promotion, so a prompt queued meanwhile runs now
            // instead of waiting for the monitor.
            // Only monitors waiting on a condition that ends park; a dev server started with a day-long
            // deadline does not hold the goal back for a day.
            if ((yield* monitors.list(sessionID)).some(Monitor.parks)) {
              if (yield* promoteAtIdle(sessionID)) {
                restart()
                continue
              }
              break
            }
            // A person waiting outranks a synthetic continuation: pending steers and one queued prompt
            // run before any todo nudge or goal continuation is injected, or a goal that keeps
            // continuing would starve the queue until it finished. The goal stays active; its judge
            // and continuation pick up again once the promoted prompt's turn ends.
            if (yield* promoteAtIdle(sessionID)) {
              restart()
              continue
            }
            if (!lastAssistant.error && todoContinuations < 7) {
              const tracked = yield* reviewTodos(sessionID)
              const reminder = SessionTodo.reminder(tracked)
              const agent = reminder ? yield* agents.get(lastUser.agent) : undefined
              const disabled = agent
                ? Permission.disabled(["todowrite"], Permission.merge(agent.permission, session.permission ?? [])).has(
                    "todowrite",
                  )
                : true
              if (reminder && !disabled && step < (agent?.steps ?? Infinity)) {
                const message: SessionV1.User = {
                  id: MessageID.ascending(),
                  sessionID,
                  role: "user",
                  time: { created: Date.now() },
                  agent: lastUser.agent,
                  model: lastUser.model,
                }
                yield* sessions.updateMessage(message)
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  sessionID,
                  messageID: message.id,
                  type: "text",
                  text: reminder,
                  synthetic: true,
                })
                reviewed = tracked
                todoContinuations++
                continue
              }
            } else if (!lastAssistant.error && SessionTodo.active(yield* todos.get(sessionID)).length > 0) {
              yield* goals.pause(sessionID, SessionTodo.limitReason)
              yield* guards.record({
                sessionID,
                guard: "steps",
                action: "stop",
                subject: "task-continuation",
                detail: SessionTodo.limitReason,
              })
              yield* Effect.logWarning("todo continuation limit reached", { "session.id": sessionID })
            }
            // The goal loop: gates, judge, decision. A CONTINUE is one more synthetic user message
            // and another pass through this loop — the turn never leaves `ensureRunning`, so the
            // session stays busy and the surfaces see one turn. Anything else ends the turn here
            // with the goal's status saying why.
            if (!lastAssistant.error) {
              const blocked = SessionTodo.blocker(yield* todos.get(sessionID))
              if (blocked) {
                yield* goals.block(sessionID, blocked)
                if (yield* promoteAtIdle(sessionID)) {
                  restart()
                  continue
                }
                break
              }
              const fresh = yield* sessions.get(sessionID).pipe(Effect.orDie)
              // A compaction is never the answer being judged. When it followed a finished turn,
              // the answer before it is; when that answer was already judged, nothing is.
              const answer =
                lastAssistantMsg?.info.role === "assistant" && lastAssistantMsg.info.summary
                  ? (yield* sessions.messages({ sessionID }).pipe(Effect.orDie)).findLast(
                      (message) =>
                        message.info.role === "assistant" &&
                        !message.info.summary &&
                        !!message.info.finish &&
                        message.info.id < lastAssistantMsg.info.id,
                    )
                  : lastAssistantMsg
              const judged = SessionGoal.fromMetadata(fresh.metadata)?.judged
              const unjudged =
                answer !== undefined &&
                (answer === lastAssistantMsg || judged === undefined || answer.info.time.created >= judged)
              // Judging the same answer twice would spend a goal turn on nothing new; leaving the goal
              // active would leave it with nothing driving it. It is paused with the reason instead.
              if (!unjudged)
                yield* goals
                  .pause(
                    sessionID,
                    `${CompactionGuard.COMPACTION_GUARD_PAUSE}the turn ended on a compaction after an answer that was already judged, so nothing was left to continue`,
                  )
                  .pipe(Effect.ignore)
              const outcome = yield* (
                unjudged
                  ? goals.afterTurn({ session: fresh, lastUser, lastAssistant: answer })
                  : Effect.succeed(undefined)
              ).pipe(
                Effect.catchCause((cause) =>
                  Effect.logError("goal loop failed; ending the turn", { "session.id": sessionID, cause }).pipe(
                    Effect.andThen(
                      goals.block(sessionID, `Goal verification failed: ${errorMessage(Cause.squash(cause))}`),
                    ),
                    Effect.as(undefined),
                  ),
                ),
              )
              const ag = outcome?.action === "continue" ? yield* agents.get(lastUser.agent) : undefined
              // The judge is a provider call: a prompt admitted while it ran goes first too.
              if (outcome?.action === "continue" && (yield* promoteAtIdle(sessionID))) {
                restart()
                continue
              }
              if (outcome?.action === "continue" && outcome.text && step < (ag?.steps ?? Infinity)) {
                const message: SessionV1.User = {
                  id: MessageID.ascending(),
                  sessionID,
                  role: "user",
                  time: { created: Date.now() },
                  agent: lastUser.agent,
                  model: lastUser.model,
                }
                yield* sessions.updateMessage(message)
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  sessionID,
                  messageID: message.id,
                  type: "text",
                  text: outcome.text,
                  synthetic: true,
                })
                // A new goal turn: its compactions are counted afresh.
                ineffectiveCompactions = 0
                overflowRecoveries = 0
                continue
              }
            }
            const responseCandidate =
              lastAssistantMsg?.info.role === "assistant" && lastAssistantMsg.info.summary
                ? msgs.findLast(
                    (message) =>
                      message.info.role === "assistant" &&
                      !message.info.summary &&
                      !!message.info.finish &&
                      message.info.id < lastAssistantMsg.info.id,
                  )
                : lastAssistantMsg
            // A revision that changes nothing material settles nothing: the issues it was asked to
            // fix stand, and reviewing it again would only start the same exchange over.
            const unchanged =
              repairedResponse !== undefined &&
              responseCandidate !== undefined &&
              Intelligence.sameResponse(repairedResponse, responseText(responseCandidate))
            // A subagent under a structured brief has its result reviewed by its parent against that
            // brief (the task tool); a generic review here as well would only double the S1 cost.
            const evaluation =
              responseCandidate &&
              !unchanged &&
              !SubagentReview.supervised(SubagentReview.fromMetadata(session.metadata))
                ? yield* reviewResponse(sessionID, msgs, responseCandidate, responseRepairs).pipe(
                    Effect.catch((error) =>
                      reportIntelligenceFailure(sessionID, "response_quality", String(error)).pipe(
                        Effect.as(undefined),
                      ),
                    ),
                  )
                : undefined
            // Only issues S1 establishes are repaired, each once; a doubtful one is left alone,
            // since the revision would read to the user as the agent replying to itself.
            const verdict = Intelligence.responseRepair(evaluation, repairedIssues)
            if (responseCandidate && verdict.repair.length && responseRepairs < 2) {
              const message: SessionV1.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
              }
              yield* sessions.updateMessage(message)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                sessionID,
                messageID: message.id,
                type: "text",
                text: Intelligence.repairPrompt(verdict.repair),
                synthetic: true,
                // Surfaces show the revision and the answer it replaces as one reply.
                metadata: { responseRepair: { issues: verdict.repair } },
              })
              repairedIssues = [...repairedIssues, ...verdict.repair]
              repairedResponse = responseText(responseCandidate)
              responseRepairs++
              continue
            }
            const unresolved = unchanged ? repairedIssues : verdict.unresolved
            if (unresolved.length || evaluation?.decision === "unavailable") {
              const detail = `${evaluation ? `System One response review ${evaluation.decision} (${evaluation.id})` : "The revised response made no material change"}. Unresolved issues: ${unresolved.join(", ") || "evaluation could not verify completion"}. Completion has not been verified.`
              yield* guards.record({ sessionID, guard: "intelligence", action: "warn", detail })
              yield* events.publish(Session.Event.Error, {
                sessionID,
                error: new NamedError.Unknown({ message: detail }).toObject(),
              })
            }
            if (yield* promoteAtIdle(sessionID)) {
              restart()
              continue
            }
            yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
            break
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            // Every subtask still pending on the message, together — not one per iteration. The
            // assistant message a subtask leaves behind is the turn's last finished message, and
            // latest() drops everything before it, so a second subtask on the same message used
            // to be skipped without a trace.
            const batch = [...tasks.filter((t): t is SessionV1.SubtaskPart => t.type === "subtask"), task]
            const concurrency = (yield* config.get()).experimental?.subtask_concurrency ?? 4
            yield* Effect.forEach(batch, (t) => handleSubtask({ task: t, model, lastUser, sessionID, session, msgs }), {
              concurrency,
              discard: true,
            })
            if (batch.some((t) => t.command)) yield* summarizeSubtasks({ lastUser, sessionID })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
              overhead,
              onMeasured: measured,
              request: lastRequest,
            })
            if (result === "paused") {
              yield* stopCompacting("paused")
              if (yield* promoteAtIdle(sessionID)) {
                restart()
                continue
              }
              break
            }
            if (result === "stop") break
            continue
          }

          if (lastFinished && lastFinished.summary !== true && relieved !== lastFinished.id) {
            // Trimming old tool output comes first: when it frees enough, no summary is needed.
            const relief = yield* compaction.relieve({
              sessionID,
              model,
              tokens: lastFinished.tokens,
              at: lastFinished.time.completed,
            })
            if (relief === "fits") {
              relieved = lastFinished.id
              continue
            }
            // Held back, the step still runs: over the threshold is not over the limit, and a
            // request the provider refuses ends the turn below with one notice.
            if (relief === "compact" && !(yield* compactionHold(msgs))) {
              yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
              continue
            }
          }

          if (lastFinished && !lastFinished.summary)
            yield* compaction.prepare({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: true,
              tokens: lastFinished.tokens,
              model,
              request: lastRequest,
            })

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const currentUser = msgs.findLast(
            (message) => message.info.role === "user" && message.info.id === lastUser.id,
          )
          const availableSkills = (yield* skills.available(agent)).flatMap((skill) =>
            skill.description === undefined ? [] : [{ name: skill.name, description: skill.description }],
          )
          const goal = yield* goals.get(sessionID).pipe(Effect.orDie)
          const classificationState = {
            mode: agent.name,
            goal: Intelligence.evidence(
              goal
                ? {
                    objective: goal.objective,
                    contract: goal.contract,
                    gates: goal.gates,
                    stopAfter: goal.stopAfter,
                    status: goal.status,
                    reason: goal.reason,
                  }
                : undefined,
              {
                reference: `${sessionID}/goal`,
                limit: 4000,
              },
            ),
            plan: Intelligence.evidence(SessionPlan.guidance(yield* plans.list(sessionID)), {
              reference: `${sessionID}/plans`,
              limit: 6000,
            }),
          }
          yield* Effect.forEach(
            msgs.filter(
              (message) =>
                message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
            ),
            (message) =>
              Effect.gen(function* () {
                const preceding = msgs.slice(0, msgs.indexOf(message))
                const result = yield* evaluateIntelligence(
                  {
                    sessionID,
                    operation: "prompt_classification",
                    kind: "classification",
                    subjectID: message.info.id,
                    sources: {
                      text: Intelligence.evidence(
                        message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
                        { reference: message.info.id, limit: 12000 },
                      ),
                      files: Intelligence.evidence(
                        message.parts.flatMap((part) =>
                          part.type === "file"
                            ? [{ filename: part.filename, mime: part.mime, reference: part.id, contentReviewed: false }]
                            : [],
                        ),
                        { reference: `${message.info.id}/files`, limit: 2000 },
                      ),
                      session: classificationState,
                      history: Intelligence.evidence(
                        {
                          messages: intelligenceHistory(preceding.slice(-12)),
                          omittedMessages: Math.max(0, preceding.length - 12),
                        },
                        { reference: `${sessionID}/before/${message.info.id}`, limit: 12000 },
                      ),
                    },
                    questions: Intelligence.promptQuestionsFor(availableSkills),
                  },
                  intelligenceAttempts,
                ).pipe(
                  Effect.catchTag("IntelligenceError", (error) =>
                    reportIntelligenceFailure(sessionID, "prompt_classification", error.message).pipe(
                      Effect.as(undefined),
                    ),
                  ),
                )
                // One attempt per unchanged input in this drain; retain the current prompt assessment.
                promptAssessments.set(message.info.id, result)
              }),
            { concurrency: 2, discard: true },
          )
          const realUser = msgs.findLast(
            (message) =>
              message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
          )
          const assessment = realUser ? promptAssessments.get(realUser.info.id) : undefined
          if (
            realUser &&
            !warmed.has(realUser.info.id) &&
            DesignIdentify.wanted({ agent: agent.name, route: Intelligence.workRoute(assessment) })
          ) {
            warmed.add(realUser.info.id)
            const directory = (yield* InstanceState.context).directory
            yield* warmDesignSystem(sessionID, directory).pipe(Effect.ignore, Effect.forkIn(scope))
          }
          const batch = msgs.findLast((message) => message.info.role === "assistant")
          const settledTools =
            batch && (!realUser || msgs.indexOf(batch) > msgs.indexOf(realUser)) ? responseToolResults([batch]) : []
          if (batch && settledTools.length) {
            const priorAttempts = intelligenceAttempts.size
            const evaluation = yield* evaluateIntelligence(
              {
                sessionID,
                operation: "tool_usage",
                kind: "gate",
                subjectID: realUser?.info.id,
                candidateID: batch.info.id,
                sources: {
                  request: Intelligence.evidence(realUser ? intelligenceHistory([realUser])[0] : undefined, {
                    reference: realUser?.info.id,
                    limit: 12000,
                  }),
                  session: classificationState,
                },
                candidate: Intelligence.evidence(settledTools, {
                  reference: `${sessionID}/${batch.info.id}/tools`,
                  limit: 24000,
                }),
                questions: Intelligence.questions({
                  failed_result:
                    "Does this batch contain a failed or incomplete result that still prevents satisfying sources.request? Do not treat a later successful verification as failure.",
                  missing_evidence:
                    "Does this batch leave a claimed outcome unverified? Truncated evidence is incomplete: request a focused verification instead of assuming missing content succeeded.",
                  scope:
                    "Does this batch show work outside the user's requested scope? This evaluation never grants permission for further actions.",
                }),
              },
              intelligenceAttempts,
            ).pipe(
              Effect.catchTag("IntelligenceError", (error) =>
                reportIntelligenceFailure(sessionID, "tool_usage", error.message).pipe(Effect.as(undefined)),
              ),
            )
            toolAssessments.set(batch.info.id, evaluation)
            if (evaluation && evaluation.decision !== "accepted" && intelligenceAttempts.size !== priorAttempts)
              yield* guards.record({
                sessionID,
                guard: "intelligence",
                action: "warn",
                detail: `System One tool review ${evaluation.decision} (${evaluation.id}): ${evaluation.issues.join(", ")}`,
              })
          }
          const toolReview = batch ? toolAssessments.get(batch.info.id) : undefined
          const toolContext =
            toolReview && toolReview.decision !== "accepted"
              ? `System One tool review ${toolReview.decision} (${toolReview.id}): ${toolReview.issues.join(", ")}. Verify missing evidence and correct failed work within the user's scope and existing permissions. An unavailable or inconclusive evaluation is not approval.`
              : undefined
          const responseRepair = currentUser?.parts.some(
            (part) => part.type === "text" && part.text.startsWith(Intelligence.RESPONSE_REPAIR),
          )
          // `auto` is never sent: the turn carries one of the model's own variants, chosen where the
          // person speaks, with one step up inside a tool loop in trouble (ReasoningAuto).
          const auto = lastUser.model.variant === ReasoningAuto.AUTO
          const dual = auto
            ? yield* intelligence.read().pipe(
                Effect.map((settings) => Intelligence.mode(settings) === "dual"),
                Effect.orElseSucceed(() => false),
              )
            : false
          const turnProgress = auto
            ? {
                ...ReasoningAuto.progress(LoopGuard.turn(msgs)),
                toolIssues:
                  toolReview !== undefined &&
                  toolReview.decision !== "accepted" &&
                  toolReview.issues.includes("failed_result"),
                repair: responseRepair === true,
              }
            : undefined
          const reasoningBounds = (yield* config.get()).reasoning?.auto
          const effort = auto
            ? ReasoningAuto.decideEffort({
                variants: Object.keys(model.variants ?? {}),
                turnID: realUser?.info.id ?? lastUser.id,
                previous: ReasoningAuto.recall(sessionID),
                assessment: Intelligence.effortAssessment(assessment),
                context: {
                  tokens:
                    lastFinished && !lastFinished.summary
                      ? lastFinished.tokens.input + lastFinished.tokens.cache.read + lastFinished.tokens.cache.write
                      : undefined,
                  window: model.limit.context,
                },
                progress: turnProgress,
                plan: agent.name === "plan",
                text: realUser?.parts
                  .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
                  .join("\n"),
                floor: reasoningBounds?.floor,
                ceiling: reasoningBounds?.ceiling,
              })
            : undefined
          if (effort) {
            ReasoningAuto.remember(sessionID, effort.state)
            yield* showEffort()
          }
          const maxSteps = agent.steps ?? Infinity
          // The agent's own bound and the turn's wall ask for the same thing at the end: stop
          // using tools and say what happened.
          const isLastStep = step >= maxSteps || budget.type === "wrap-up"
          const todowrite = !Permission.disabled(
            ["todowrite"],
            Permission.merge(agent.permission, session.permission ?? []),
          ).has("todowrite")
          // One review per step. The list rides the last user message rather than the system
          // prompt: state that changes on every todowrite would otherwise invalidate the
          // provider's cached prefix for the whole request that follows.
          const tracked = todowrite ? (reviewed ?? (yield* reviewTodos(sessionID))) : undefined
          reviewed = undefined
          // Nobody is watching an unattended run to compact or stop it, so once per compaction
          // epoch it is asked to wrap up near the limit. Attended sessions get no model warning:
          // models told the context is short tend to give up on work that would have fit.
          const wrapUp = yield* Effect.gen(function* () {
            if (!lastFinished || lastFinished.summary) return undefined
            const unattended =
              !attendedClient(flags.client) ||
              SessionGoal.fromMetadata((yield* sessions.get(sessionID).pipe(Effect.orDie)).metadata)?.status ===
                "active"
            if (!unattended) return undefined
            const epoch = msgs.findLast((message) => message.info.role === "assistant" && message.info.summary)?.info.id
            const key = epoch ?? ""
            if (wrapUps.get(sessionID) === key) return undefined
            const tokens = lastFinished.tokens
            const count = tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
            const room = usableTokens({ cfg: yield* config.get(), model, outputTokenMax: flags.outputTokenMax })
            if (!CompactionGuard.wrapUpDue({ count, usable: room })) return undefined
            wrapUps.set(sessionID, key)
            return CompactionGuard.WRAP_UP
          })
          const reminder = yield* SessionReminders.apply({
            messages: msgs,
            agent,
            session,
            todos: tracked,
            wrapUp,
          }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
            Effect.provideService(DesignStudio.Service, design),
            Effect.provideService(SessionPlan.Service, plans),
            Effect.orDie,
          )

          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: effort?.level ?? lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          // A reached spend budget ends the turn before another provider step. The reason goes in
          // the transcript as a notice the model never receives; no empty assistant row is left.
          const refused = yield* goals.admit({
            sessionID,
            messageID: lastUser.id,
            human: SessionBudget.human(msgs, lastUser.id),
          })
          if (refused) {
            msg.finish = "stop"
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID,
              type: "text",
              text: refused,
              synthetic: true,
              ignored: true,
            })
            break
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              modelID: msg.modelID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          ran = true
          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              // Already incremented for this iteration, so this is the 1-based step number.
              model,
              step,
              reconnectAttempt: reconnects + 1,
              beforeAttempt: () => goals.beginTurn(sessionID),
              onFailure: (reason) => goals.block(sessionID, `Provider request failed: ${reason}`),
              // Subagents run the model their agent names; only the person's own session is offered another.
              onRetry: () => (session.parentID ? Effect.void : suggestions.failure({ sessionID, model })),
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          watched = handle

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops(sessionID)

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
            const decided = yield* hooks.waterfall(OperationHook.Operation.Agent.PreStep, {
              timestamp: yield* DateTime.now,
              sessionID,
              agent: agent.name,
              messageID: handle.message.id,
              messages: msgs,
            })
            msgs = decided.messages as typeof msgs

            const toolSearch = (yield* config.get()).experimental?.tool_search
            // Design tools stay loaded for the design agent and for any Session that has Design
            // documents, which is also where an approved Design handed to build lives.
            const designContext =
              toolSearch?.enabled === false ||
              agent.name === "design" ||
              // The store dies on a database error, so only a cause-level catch sees it; failing
              // open keeps the design tools loaded rather than hiding them on an unreadable store.
              (yield* design.use(DesignStore.Service.use((store) => store.list(sessionID))).pipe(
                Effect.map((documents) => documents.length > 0),
                Effect.catchCause(() => Effect.succeed(true)),
              ))
            const mcpCatalog: { name: string; description: string }[] = []
            const tools = yield* SessionTools.resolve({
              onMcpTools: (entries) => mcpCatalog.push(...entries),
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
              publishEvent: events.publish,
              toolTimeout: (yield* config.get()).experimental?.tool_timeout,
              mcpValidation: (yield* config.get()).experimental?.mcp_validation,
              toolSearch,
              userTools: lastUser.tools,
              designContext,
              recordGuard: guards.record,
              ...(lastUser.format?.type === "json_schema"
                ? {
                    structuredOutputTool: createStructuredOutputTool({
                      schema: lastUser.format.schema,
                      onSuccess(output) {
                        structured = output
                      },
                    }),
                  }
                : {}),
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(ToolOutputBridge.Service, outputs),
              Effect.provideService(RuntimeFlags.Service, flags),
              Effect.provideService(OperationHookBridge.Service, hooks),
            )

            // Only suggests: a card asks the person, and nothing switches unless they accept.
            if (!session.parentID)
              yield* suggestions.observe({
                sessionID,
                model,
                messages: msgs,
                tools: Object.keys(tools).length > 0,
                finished: lastFinished,
                usable: usableTokens({ cfg: yield* config.get(), model, outputTokenMax: flags.outputTokenMax }),
              })

            const selectionID = `mcp-selection:${Intelligence.fingerprint({ tools: mcpCatalog, request: realUser?.info.id, batch: batch?.info.id })}`
            if (mcpCatalog.length && realUser) {
              const evaluation = yield* evaluateIntelligence(
                {
                  sessionID,
                  operation: "tool_usage",
                  kind: "classification",
                  subjectID: realUser.info.id,
                  candidateID: selectionID,
                  sources: {
                    request: Intelligence.evidence(
                      realUser.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
                      { reference: realUser.info.id, limit: 6000 },
                    ),
                    session: classificationState,
                    history: Intelligence.evidence(intelligenceHistory(msgs.slice(-6)), {
                      reference: `${sessionID}/recent`,
                      limit: 6000,
                    }),
                    tool_results: Intelligence.evidence(settledTools, { reference: batch?.info.id, limit: 4000 }),
                  },
                  questions: Intelligence.toolQuestionsFor(mcpCatalog),
                },
                intelligenceAttempts,
              ).pipe(
                Effect.catchTag("IntelligenceError", (error) =>
                  reportIntelligenceFailure(sessionID, "MCP selection", error.message).pipe(Effect.as(undefined)),
                ),
              )
              toolAssessments.set(selectionID, evaluation)
            }
            const mcpContext = Intelligence.toolContext(toolAssessments.get(selectionID))
            const skillContext = Intelligence.skillContext(assessment)

            // The safe provider-turn boundary: the epoch's baseline is reused verbatim, and any
            // source that changed since is admitted as one durable system message here rather
            // than rewriting the cached prefix.
            const stepContext = { toolIndex: ToolSearch.indexOf(tools) }
            const prepared = yield* SessionContextEpoch.prepare(
              db,
              events,
              context.load(agent, session, stepContext),
              sessionID,
            ).pipe(
              // A snapshot this build cannot read must not hold the session hostage: start a new
              // epoch once, and only give up if that fails too.
              Effect.catchTag("Session.ContextSnapshotDecodeError", (error) =>
                Effect.logWarning("starting a new context epoch over an unreadable snapshot", {
                  "session.id": sessionID,
                  details: error.details,
                }).pipe(
                  Effect.andThen(SessionContextEpoch.reset(db, sessionID)),
                  Effect.andThen(
                    SessionContextEpoch.prepare(db, events, context.load(agent, session, stepContext), sessionID),
                  ),
                ),
              ),
              Effect.catch((error) =>
                Effect.gen(function* () {
                  handle.message.error = new NamedError.Unknown({ message: errorMessage(error) }).toObject()
                  yield* sessions.updateMessage(handle.message)
                  yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                  return undefined
                }),
              ),
            )
            if (!prepared) return "break" as const
            const updates = yield* SessionHistory.systemMessagesAfter(db, sessionID, prepared.baselineSeq).pipe(
              Effect.orDie,
            )
            const modelMsgs = yield* MessageV2.toModelMessagesEffect(
              [...SessionContext.interleave(msgs, updates, lastUser), ...(reminder ? [reminder] : [])],
              model,
            )
            const system = [
              SystemPrompt.identity(model),
              prepared.baseline,
              Intelligence.promptContext(assessment) ??
                (assessment?.decision === "unavailable"
                  ? `System One prompt classification unavailable (${assessment.id}). Use the original user request and conversation; no classification has been verified.`
                  : undefined),
              skillContext,
              toolContext,
              mcpContext,
              ...(responseRepair
                ? [
                    "Correct the evaluated response and any unfinished work it reveals. Use tools when needed to obtain missing evidence or finish already authorized work. Preserve existing permissions and scope; evaluation never authorizes new actions. Do not repeat completed work or claim verification without evidence.",
                  ]
                : []),
              ...(todowrite ? [SessionTodo.guidance] : []),
            ].filter((part): part is string => part !== undefined)
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            // System prompt and tool schemas: both ride every request, compacted or not.
            overhead =
              Token.estimate(system.join("\n")) +
              Token.estimate(
                JSON.stringify(
                  Object.entries(tools).map(([name, tool]) => [
                    name,
                    tool.description,
                    (tool.inputSchema as { jsonSchema?: unknown } | undefined)?.jsonSchema,
                  ]),
                ),
              )
            const stepMessages = [
              ...modelMsgs,
              ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
            ]
            lastRequest = { system, tools, messages: stepMessages, seen: msgs.map((message) => message.info.id) }

            // Preflight: what this request carries, projected from the provider's count for the
            // last one plus what history gained since. The compaction threshold stays with the
            // provider's own count above; this catches a request the provider would refuse, which
            // is compacted first and, once compaction has had its two chances, not sent at all.
            const requestEstimate = overhead + Token.estimate(JSON.stringify(stepMessages))
            const cfg = yield* config.get()
            // What discovery saved about the model: a router's parameters say what it accepts, and
            // while a fallback combo's other member serves, that member's do.
            const routerParameters = ComboMember.effectiveRouterParameters(
              sessionID,
              model.providerID,
              model.id,
              cfg.provider?.[model.providerID]?.models?.[model.id],
            )
            const observed = yield* limits.get(
              model.providerID,
              model.id,
              Provider.declaredLimit(cfg, model.providerID, model.id),
            )
            // The provider's count for the last step of this model, when there is one, plus what
            // history gained since: the step's own output and tool results, and every message
            // after it. When this drain sent that step, the gain is the difference of estimates.
            // A count taken before old tool output was trimmed no longer describes the history.
            const evidence =
              lastFinished &&
              !lastFinished.summary &&
              lastFinished.modelID === model.id &&
              lastFinished.providerID === model.providerID &&
              relieved !== lastFinished.id
                ? lastFinished
                : undefined
            const gained = yield* Effect.gen(function* () {
              if (!evidence) return 0
              if (lastSent?.messageID === evidence.id) return Math.max(0, requestEstimate - lastSent.estimate)
              const since = msgs.slice(msgs.findIndex((message) => message.info.id === evidence.id))
              if (since.length === 0) return 0
              return Token.estimate(JSON.stringify(yield* MessageV2.toModelMessagesEffect(since, model)))
            })
            const accepted = evidence ? SessionPreflight.counted(evidence.tokens) : undefined
            const projection = SessionPreflight.project({
              estimate: requestEstimate,
              observed,
              last: accepted === undefined ? undefined : { counted: accepted, gained },
            })
            const limit = hardLimit({ model, outputTokenMax: flags.outputTokenMax })
            const maxOutput = ProviderTransform.maxOutputTokens(model, flags.outputTokenMax)
            if (
              cfg.compaction?.auto !== false &&
              projection !== undefined &&
              SessionPreflight.exceeds({ projection, limit, accepted, observed })
            ) {
              yield* Effect.logInfo("request projected over the provider limit", {
                "session.id": sessionID,
                projected: projection.tokens,
                anchored: projection.anchored,
                estimate: requestEstimate,
                limit,
                recoveries: overflowRecoveries,
              })
              const hold = yield* compactionHold(msgs)
              const exhausted = hold !== undefined || overflowRecoveries >= SessionPreflight.MAX_RECOVERIES
              // Refused only on the provider's own count against the provider's own limit; a
              // projection from the estimate alone is sent for the provider to decide.
              if (exhausted && SessionPreflight.refusable({ projection, observed })) {
                yield* refuseOversized({ message: handle.message, model, projected: projection.tokens })
                return "break" as const
              }
              if (!exhausted) {
                // Trimming old tool output may be enough; the trimmed request is projected again.
                const relief = yield* compaction.relieve({
                  sessionID,
                  model,
                  tokens: SessionPreflight.tokens(projection.tokens),
                  at: lastFinished?.time.completed,
                })
                if (relief === "fits") {
                  if (lastFinished) relieved = lastFinished.id
                  return "continue" as const
                }
                overflowRecoveries++
                // A request that cannot be sent is treated like one the provider refused: the
                // person's request is replayed after the summary.
                yield* compaction.create({
                  sessionID,
                  agent: lastUser.agent,
                  model: lastUser.model,
                  auto: true,
                  overflow: true,
                })
                return "continue" as const
              }
            }
            lastSent = { messageID: handle.message.id, estimate: requestEstimate }
            const result = yield* handle.process({
              user: effort ? { ...lastUser, model: { ...lastUser.model, variant: effort.level } } : lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: stepMessages,
              tools,
              model,
              // Models that always think reject a forced tool choice; they are asked for the tool instead.
              toolChoice:
                format.type === "json_schema"
                  ? ProviderTransform.supportsForcedToolChoice(model, routerParameters)
                    ? "required"
                    : "auto"
                  : undefined,
              estimate: requestEstimate,
              // System One already chose this turn's tools and skills; a RedRouter must not choose again.
              // Its hint lets a RedRouter combo pick the model for the turn; Redcode never switches it.
              // Who decides the effort is settled per request against the detected router.
              router: {
                ...(mcpContext || skillContext ? { decision: false } : {}),
                hint: Intelligence.routerHint(
                  assessment,
                  toolAssessments.get(selectionID),
                  auto ? { stall: ReasoningAuto.stalled(turnProgress) } : undefined,
                ),
                reasoning: { auto, dual, level: effort?.level },
              },
            })
            // A router that decided reports its level with the response.
            if (auto) yield* showEffort()

            if (result === "reconnect") {
              reconnects++
              const message: SessionV1.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
              }
              yield* sessions.updateMessage(message)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                sessionID,
                messageID: message.id,
                type: "text",
                text: SessionRetry.CONNECTION_CONTINUATION_PROMPT,
                synthetic: true,
              })
              return "continue" as const
            }
            reconnects = 0

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // Surface any content-filter finish (e.g. Anthropic stop_reason:
              // refusal) as an error. These turns may have produced no visible
              // output at all — previously the session went idle silently — or
              // partial text that was cut off by the provider's filter.
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                return "break" as const
              }
              if (format.type === "json_schema") {
                // Without a forced tool choice the model may answer in text; remind it before failing.
                if (
                  !ProviderTransform.supportsForcedToolChoice(model, routerParameters) &&
                  structuredReminders < (format.retryCount ?? 2)
                ) {
                  structuredReminders++
                  const reminder: SessionV1.User = {
                    id: MessageID.ascending(),
                    sessionID,
                    role: "user",
                    time: { created: Date.now() },
                    agent: lastUser.agent,
                    model: lastUser.model,
                    format,
                  }
                  yield* sessions.updateMessage(reminder)
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    sessionID,
                    messageID: reminder.id,
                    type: "text",
                    text: STRUCTURED_OUTPUT_REMINDER,
                    synthetic: true,
                  })
                  return "continue" as const
                }
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: structuredReminders,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            const failed = handle.message.error
            if (!session.parentID && SessionV1.APIError.isInstance(failed))
              yield* suggestions.failure({ sessionID, model, status: failed.data.statusCode })
            if (!session.parentID && !failed && handle.message.finish) yield* suggestions.recovered(sessionID)

            if (result === "stop") {
              // A loop-guard stop breaks here, before the goal loop below, so an active goal would
              // otherwise stay active on an idle session.
              if (handle.guardStop) yield* goals.pause(sessionID, handle.guardStop).pipe(Effect.ignore)
              return "break" as const
            }
            // A request the provider accepted above the lesson raises the lesson.
            if (observed && handle.message.finish && !handle.message.error) {
              const raised = ModelLimit.raised(observed, SessionPreflight.counted(handle.message.tokens), maxOutput)
              if (raised) {
                yield* limits.learn(model.providerID, model.id, raised)
                yield* Verbose.log("model.limit.learned", {
                  sessionID,
                  providerID: model.providerID,
                  modelID: model.id,
                  limit: raised.limit,
                  from: "accepted request",
                })
                yield* Effect.logInfo("provider accepted more than its learned limit; raised it", {
                  "session.id": sessionID,
                  providerID: model.providerID,
                  modelID: model.id,
                  accepted: SessionPreflight.counted(handle.message.tokens),
                  limit: raised.limit,
                })
              }
            }
            if (result === "compact") {
              const refused = !handle.message.finish
              // The provider's refusal says what its limit is: the next request is sized by it.
              // The estimate of a request with images or files in it calibrates nothing.
              if (refused && handle.overflow)
                yield* learnLimit({
                  sessionID,
                  model,
                  error: handle.overflow,
                  estimate: msgs.some((message) => message.parts.some((part) => part.type === "file"))
                    ? undefined
                    : requestEstimate,
                })
              // A finished step that crossed the threshold may only need old tool output trimmed.
              if (
                handle.message.finish &&
                (yield* compaction.relieve({
                  sessionID,
                  model,
                  tokens: handle.message.tokens,
                  at: handle.message.time.completed,
                })) === "fits"
              ) {
                relieved = handle.message.id
                return "continue" as const
              }
              // Two recoveries per turn, before or after a refusal, then the refusal is reported
              // with what to do about it instead of another summary that cannot fit either.
              if (refused && overflowRecoveries >= SessionPreflight.MAX_RECOVERIES) {
                yield* refuseOversized({
                  message: handle.message,
                  model,
                  projected: projection?.tokens ?? requestEstimate,
                })
                return "break" as const
              }
              const hold = yield* compactionHold(msgs)
              if (hold) {
                // A finished step only crossed the threshold; the next step decides again.
                if (handle.message.finish) return "continue" as const
                handle.message.error ??= new SessionV1.ContextOverflowError({
                  message: hold === "paused" ? CompactionGuard.PAUSED : CompactionGuard.LIMIT,
                }).toObject()
                handle.message.finish = "error"
                yield* sessions.updateMessage(handle.message)
                yield* stopCompacting(hold)
                return "break" as const
              }
              if (refused) overflowRecoveries++
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: refused,
              })
            }
            if (result === "continue" && !finished && !handle.message.error) {
              if (yield* checkStopLoss({ step, lastUser, agent, model })) return "break" as const
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        // Old tool output is no longer pruned here: right after a request the provider's cache is
        // still warm, and trimming would throw it away. It is trimmed before the next compaction,
        // or once the session has idled past the cache's lifetime.
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(
        input.sessionID,
        lastAssistant(input.sessionID),
        runLoop(input.sessionID).pipe(
          Effect.ensuring(compaction.discard(input.sessionID)),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              // What the drain leaves queued missed its boundary (see `stale`): after a normal end,
              // what its last idle check passed on; after an Esc or a failure, everything queued.
              const checked = checkedThrough.get(input.sessionID)
              checkedThrough.delete(input.sessionID)
              const failed =
                Exit.isFailure(exit) || (exit.value.info.role === "assistant" && exit.value.info.error !== undefined)
              const through = failed
                ? (yield* SessionInput.listPending(db, input.sessionID, { delivery: "queue" })).at(-1)?.admittedSeq
                : checked
              if (through !== undefined)
                skippedThrough.set(input.sessionID, Math.max(through, skippedThrough.get(input.sessionID) ?? -1))
              if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
                yield* goals.block(input.sessionID, `Execution failed: ${errorMessage(Cause.squash(exit.cause))}`)
              if (Exit.isSuccess(exit) && exit.value.info.role === "assistant" && exit.value.info.error)
                yield* goals.block(input.sessionID, `Execution failed: ${errorMessage(exit.value.info.error)}`)
              const turnEnded = {
                sessionID: input.sessionID,
                timestamp: yield* DateTime.now,
                finished: Exit.isSuccess(exit),
              }
              yield* hooks.parallel(OperationHook.Operation.Turn.Ended, turnEnded)
              yield* events.publish(SessionEvent.Turn.Ended, turnEnded).pipe(Effect.ignore)
            }),
          ),
        ),
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      let parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...uniqueTemplateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )
      const decidedCommand = yield* hooks.waterfall(OperationHook.Operation.Command.PreExecute, {
        timestamp: yield* DateTime.now,
        sessionID: input.sessionID,
        command: input.command,
        arguments: input.arguments,
        parts,
      })
      parts = decidedCommand.parts as typeof parts

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    const setDelivery = Effect.fn("SessionPrompt.setDelivery")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      delivery: SessionInput.Delivery
    }) {
      const row = yield* SessionInput.setDelivery(db, events, {
        sessionID: input.sessionID,
        id: SessionMessage.ID.make(input.messageID),
        delivery: input.delivery,
      })
      if (row === undefined) return undefined
      // A running drain reads pending steers from the inbox at every boundary, so it picks the
      // change up by itself; `loop` joins that drain rather than starting a second one. A session
      // with nothing running has no boundary coming, so the steer starts one, the same way a prompt
      // sent to an idle session does. Detached: the caller does not wait for the turn.
      if (row.delivery === "steer")
        yield* Effect.gen(function* () {
          // Unlike `notify`, this wake checks neither the cancel generation nor the goal status:
          // a person asked for this steer just now, which outranks both.
          //
          // Joining a drain past its last promotion boundary returns without promoting the steer,
          // and so can the drain after it. Keep waking while the steer is still pending — once the
          // session reports idle a fresh drain starts and promotes it — with a ceiling so a row
          // that can never be promoted (its message never stored) cannot spin here.
          for (let attempt = 0; attempt < 10; attempt++) {
            yield* loop({ sessionID: input.sessionID })
            if (!(yield* SessionInput.hasPending(db, input.sessionID, "steer"))) return
          }
          yield* Effect.logWarning("gave up waking the session for a converted steer", {
            "session.id": input.sessionID,
            messageID: input.messageID,
          })
        }).pipe(Effect.forkIn(scope))
      return row
    })

    const pending = Effect.fn("SessionPrompt.pending")(function* (sessionID: SessionID) {
      return (yield* SessionInput.listPending(db, sessionID)).map((row) =>
        PendingPrompt.make({
          id: MessageID.make(row.id),
          delivery: row.delivery,
          text: row.prompt.text,
          files: row.prompt.files?.length ?? 0,
          time: DateTime.toEpochMillis(row.timeCreated),
          stale: stale(row),
        }),
      )
    })

    const discard = Effect.fn("SessionPrompt.discard")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      return yield* SessionInput.discard(db, events, {
        sessionID: input.sessionID,
        id: SessionMessage.ID.make(input.messageID),
      })
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
      setDelivery,
      pending,
      discard,
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  delivery: Schema.optional(SessionInput.Delivery).annotate({
    description:
      "How the prompt reaches the model: `steer` (default) is promoted at the next safe boundary of a running turn, `queue` waits until the session would otherwise go idle",
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export const PendingPrompt = Schema.Struct({
  id: MessageID,
  delivery: SessionInput.Delivery,
  text: Schema.String,
  /** Attached files, which the text alone does not show. */
  files: Schema.Finite,
  /** When it was admitted, in epoch milliseconds. */
  time: Schema.Finite,
  stale: Schema.Boolean.annotate({
    description:
      "Queued before the session last went idle without taking it up. A stale prompt is never promoted on its own: it waits to be sent as a steer or discarded",
  }),
}).annotate({ identifier: "SessionPendingPrompt" })
export type PendingPrompt = Schema.Schema.Type<typeof PendingPrompt>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    DesignStudio.node,
    GoalRuntime.node,
    SessionModelSuggestion.node,
    SessionSpend.node,
    SessionPlan.node,
    SessionGuardLog.node,
    SessionStatus.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    ToolOutputBridge.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionContext.node,
    SessionSummary.node,
    SystemPrompt.node,
    LLM.node,
    EventV2Bridge.node,
    OperationHookBridge.node,
    RuntimeFlags.node,
    Database.node,
    MonitorRuntime.node,
    Todo.node,
    ModelLimit.node,
    Intelligence.node,
    Skill.node,
  ],
})

export * as SessionPrompt from "./prompt"
