import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Verbose } from "@reddb-io/redcode-core/observability/verbose"
import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Cause, Clock, DateTime, Deferred, Duration, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { ProviderError } from "@/provider/error"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LoopGuard } from "./loop-guard"
import { SessionGuardLog } from "./guard-log"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { Database } from "@reddb-io/redcode-core/database/database"
import { Usage, type LLMEvent } from "@reddb-io/redcode-llm"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { GenerationTiming } from "@reddb-io/redcode-core/session/generation-timing"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"

/** Steps of one turn to look back over. Comfortably more than any sane `stop_at`. */
const LOOP_WINDOW = 16
/** `switch`: another model was selected while a retry waited, and the request goes to it instead. */
export type Result = "compact" | "stop" | "continue" | "reconnect" | "switch"

export interface Handle {
  readonly message: SessionV1.Assistant
  /** When the provider last sent anything, for the turn loop's stall watchdog. */
  readonly lastEventAt: number
  /**
   * Tool calls the model is waiting on right now. Tools run inside the SDK, between the
   * `tool-call` and `tool-result` events, so a long command or a subagent emits nothing at all:
   * silence with a tool in flight is work, and only silence with none is a stall.
   */
  readonly activeToolCount: number
  /**
   * The loop guard's message when it ended this turn. The turn then breaks before goal handling, so
   * the turn loop has to park an active goal with this reason itself.
   */
  readonly guardStop?: string
  /**
   * The provider's refusal when the last attempt was a context overflow that compaction recovers:
   * not recorded on the message, so the turn loop reads what the provider said here.
   */
  readonly overflow?: NonNullable<SessionV1.Assistant["error"]>
  /** The provider will not serve the model before a reset too far off to wait for; the turn ended on it. */
  readonly exhausted?: SessionRetry.Exhausted
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  /**
   * Whether this call has already been made, with these arguments, to the same answer.
   *
   * Asked before the tool runs, so a call that cannot produce anything new is never run at all.
   * A `stop` decision also ends the turn after this step.
   */
  readonly guardLoop: (input: { tool: string; input: unknown }) => Effect.Effect<LoopGuard.Decision>
  readonly process: (streamInput: LLM.StreamInput, preparedEvents?: readonly LLMEvent[]) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: SessionV1.Assistant
  sessionID: SessionID
  model: Provider.Model
  /** Which step of the turn this handle serves, counting from 1. Reported in the busy status. */
  step?: number
  /** Consecutive safe continuations after a provider connection failure, counting from 1. */
  reconnectAttempt?: number
  /** Admit every primary provider attempt, including retries, before starting the stream. */
  beforeAttempt?: () => Effect.Effect<boolean>
  onFailure?: (reason: string) => Effect.Effect<void>
  /** A provider attempt failed and is about to be retried. */
  onRetry?: () => Effect.Effect<void>
  /**
   * Completes when the person next selects another model; each run waits for a new selection. While
   * a retry waits out its delay, that ends the wait and `process` returns `switch`; at any other time
   * it is ignored.
   */
  switched?: Effect.Effect<unknown>
  /** The handle writes a compaction summary: every phase it reports is `compacting`. */
  compacting?: boolean
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  /** Last phase published, so the same one is not published twice. */
  phase?: "preparing" | "thinking" | "writing" | "tool" | "compacting"
  phaseTool?: string
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  /** Set when the loop guard decided to stop the turn. */
  guardStop?: string
  /** The refusal behind `needsCompaction` when it came from the provider rather than the count. */
  overflow?: NonNullable<SessionV1.Assistant["error"]>
  needsCompaction: boolean
  currentText: SessionV1.TextPart | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
  /** When the provider last sent anything. A stalled turn is one where this stops moving. */
  lastEventAt: number
  /**
   * Parts written by the provider attempt in flight. A retried stream replays from the start, so
   * whatever the failed attempt persisted has to go before the next attempt appends its own.
   */
  attemptParts: PartID[]
  /**
   * Whether a tool in this attempt reached running. A retry replays the same request, so the model
   * would ask for that tool again and its side effect would happen twice.
   */
  attemptExecuted: boolean
  /** A retryable failure after a tool ran must continue from history instead of replaying the call. */
  reconnect: boolean
  /** The step's visible output and reasoning tokens once the provider reported usage. */
  stepUsage: { output: number; reasoning: number } | undefined
  /** A failed attempt is waiting out its retry delay: a model switch may end the wait. */
  retrying: boolean
  /** A model switch ended a retry wait. */
  retargeted: boolean
  exhausted?: SessionRetry.Exhausted
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionProcessor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const guards = yield* SessionGuardLog.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const hooks = yield* OperationHookBridge.Service
    const database = yield* Database.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
        lastEventAt: Date.now(),
        attemptParts: [],
        attemptExecuted: false,
        reconnect: false,
        stepUsage: undefined,
        retrying: false,
        retargeted: false,
      }
      let aborted = false
      // Stamped as events are read: the generation window, the provider's wait and the local work
      // before the request, per attempt. See GenerationTiming for what each number covers. Read from
      // the fiber's clock, which is monotonic by default and lets a TestClock script arrival times.
      const clock = yield* Clock.Clock
      const now = () => Number(clock.currentTimeNanosUnsafe()) / 1_000_000
      const timing = GenerationTiming.recorder({
        created: input.assistantMessage.time.created,
        now,
        epoch: () => clock.currentTimeMillisUnsafe(),
      })
      const arrived = GenerationTiming.arrivals(now)

      /** A fresh part id, remembered so the attempt's output can be discarded if it is retried. */
      const nextPartID = () => {
        const id = PartID.ascending()
        ctx.attemptParts.push(id)
        return id
      }

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          modelID: input.model.id,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return undefined
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        if (part.state.status !== "pending") ctx.attemptExecuted = true
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: SessionV1.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            // Keep metadata streamed while running so failures retain progress detail (e.g. execute's child calls).
            metadata: match.part.state.metadata,
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        const part = yield* session.updatePart({
          id: nextPartID(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies SessionV1.ToolPart)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      /**
       * The message as written before cleanup: a summary never publishes its `finish` early, because
       * compaction owns validating and publishing a successful history boundary.
       */
      const unsettled = () => ({
        ...ctx.assistantMessage,
        finish: ctx.assistantMessage.summary && !ctx.assistantMessage.error ? undefined : ctx.assistantMessage.finish,
      })

      /** The first token is written at once, so a client shows the provider's latency while it streams. */
      const recordFirstToken = Effect.fn("SessionProcessor.recordFirstToken")(function* () {
        ctx.assistantMessage.timing = timing.snapshot()
        ctx.assistantMessage.time.first = ctx.assistantMessage.timing?.firstToken
        yield* session.updateMessage(unsettled())
      })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: nextPartID(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            yield* phase("thinking")
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            yield* ensureToolCall(value)
            return

          case "tool-input-end": {
            yield* ensureToolCall(value)
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            const input = isRecord(value.input) ? value.input : { value: value.input }
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? { ...match.state, input }
                  : {
                      status: "running",
                      input,
                      time: { start: Date.now() },
                    },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            yield* phase("tool", value.name)
            // Repetition is judged in guardLoop, before the tool runs, so the model reads the
            // correction as an ordinary tool result instead of the user being asked a question.
            return
          }

          case "tool-result": {
            const toolCall = yield* readToolCall(value.id)
            if (!toolCall && value.result.type === "error") return
            if (value.result.type === "error") {
              yield* failToolCall(value.id, value.result.value)
              return
            }
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            yield* completeToolCall(value.id, output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            // An exhausted account or a content-policy refusal mid-stream fails the same way again.
            if (value.classification === "quota" || value.classification === "content-policy")
              throw new ProviderError.ResponseStreamError(value.message, { refusal: value.classification })
            throw new Error(value.message)

          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
              id: nextPartID(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            // Anthropic reports thinking blocks it removed before the model saw the
            // prompt. Prefix mismatches mean opencode changed history behind a signed
            // block; log them so the churn can be tracked down.
            const dropped = isRecord(value.providerMetadata?.anthropic)
              ? value.providerMetadata.anthropic.inputTransformations
              : undefined
            if (Array.isArray(dropped) && dropped.length > 0) {
              yield* Effect.logWarning("thinking blocks dropped by provider", {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                model: ctx.model.id,
                transformations: JSON.stringify(dropped),
              })
            }
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            if (!ctx.assistantMessage.summary) ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            ctx.stepUsage = { output: usage.tokens.output, reasoning: usage.tokens.reasoning }
            if (!ctx.assistantMessage.timing?.replayed) ctx.assistantMessage.timing = timing.snapshot(ctx.stepUsage)
            yield* Verbose.log("provider.response", () => ({
              sessionID: ctx.sessionID,
              providerID: ctx.model.providerID,
              modelID: ctx.model.id,
              reason: value.reason,
              ms: Date.now() - ctx.assistantMessage.time.created,
              input: usage.tokens.input,
              output: usage.tokens.output,
              reasoning: usage.tokens.reasoning,
              cacheRead: usage.tokens.cache.read,
              cacheWrite: usage.tokens.cache.write,
              cost: usage.cost,
            }))
            const servedModel = ProviderRouter.reportedServedModel(value.providerMetadata)
            yield* session.updatePart({
              id: nextPartID(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              ...(servedModel ? { servedModel } : {}),
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: nextPartID(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: nextPartID(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            yield* phase("writing")
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            const textCompleteV1 = yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )
            const textCompleteV2 = yield* hooks.waterfall(OperationHook.Operation.Text.Complete, {
              timestamp: yield* DateTime.now,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              partID: ctx.currentText.id,
              text: textCompleteV1.text,
            })
            ctx.currentText.text = textCompleteV2.text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            if (ctx.assistantMessage.summary) ctx.assistantMessage.finish = value.reason
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        if (!ctx.assistantMessage.timing?.replayed) ctx.assistantMessage.timing = timing.snapshot(ctx.stepUsage)
        // Compaction owns validation and publication of a successful history boundary.
        yield* session.updateMessage(unsettled())
      })

      const discardAttempt = Effect.fn("SessionProcessor.discardAttempt")(function* () {
        // Only pending tool calls can be here: one that started running makes the failure terminal.
        yield* Effect.forEach(Object.keys(ctx.toolcalls), settleToolCall)
        yield* Effect.forEach(ctx.attemptParts, (partID) =>
          session.removePart({
            sessionID: ctx.assistantMessage.sessionID,
            messageID: ctx.assistantMessage.id,
            partID,
          }),
        )
        ctx.attemptParts = []
        ctx.currentText = undefined
        ctx.reasoningMap = {}
        // A failed attempt's first token is not the answer's: the next attempt measures its own.
        timing.discard()
        arrived.clear()
        ctx.stepUsage = undefined
        if (ctx.assistantMessage.timing === undefined && ctx.assistantMessage.time.first === undefined) return
        ctx.assistantMessage.timing = undefined
        ctx.assistantMessage.time.first = undefined
        yield* session.updateMessage(unsettled())
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        // The failure's kind only: a provider's message can quote the request it rejected.
        yield* Verbose.log("provider.error", () => ({
          sessionID: input.sessionID,
          providerID: input.model.providerID,
          modelID: input.model.id,
          error: e instanceof Error ? e.name : typeof e,
          ms: Date.now() - input.assistantMessage.time.created,
        }))
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        const parsed = parse(e)
        const exhausted = SessionRetry.exhausted(parsed)
        ctx.exhausted = exhausted
        // A reset too far off to wait for: say which model, until when, and what to do instead.
        const error =
          exhausted && SessionV1.APIError.isInstance(parsed)
            ? {
                ...parsed,
                data: {
                  ...parsed.data,
                  message: SessionRetry.exhaustedMessage(modelLabel(input.model), exhausted),
                },
              }
            : parsed
        if (SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            if (input.onFailure) yield* input.onFailure(errorMessage(e))
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
          ctx.overflow = error
          // Recovered by compaction, so not an error anyone has to act on. If compaction cannot
          // recover it, the loop reports that once, with what to do about it.
          yield* Effect.logInfo("context overflow; compacting", {
            "session.id": ctx.sessionID,
            messageID: ctx.assistantMessage.id,
          })
          return
        }
        ctx.assistantMessage.error = error
        if (input.onFailure) yield* input.onFailure(errorMessage(e))
        yield* events.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (
        streamInput: LLM.StreamInput,
        preparedEvents?: readonly LLMEvent[],
      ) {
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.overflow = undefined
        ctx.retargeted = false
        ctx.exhausted = undefined
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        // A model selected while an attempt streams is no reason to drop it: only a retry wait ends.
        const switched = input.switched
        const switchedWhileWaiting: Effect.Effect<void> = switched
          ? Effect.gen(function* () {
              while (true) {
                yield* switched
                if (!ctx.retrying) continue
                ctx.retargeted = true
                return
              }
            })
          : Effect.never

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.retrying = false
            timing.attempt()
            arrived.clear()
            if (input.beforeAttempt && !(yield* input.beforeAttempt())) {
              ctx.blocked = true
              ctx.assistantMessage.finish = "stop"
              return
            }
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            ctx.attemptParts = []
            ctx.attemptExecuted = false
            ctx.reconnect = false
            ctx.phase = undefined
            ctx.phaseTool = undefined
            yield* phase("preparing")
            // Replayed events were collected earlier, so reading them now measures nothing: the
            // message says so instead of showing the replay's local speed.
            if (preparedEvents) ctx.assistantMessage.timing = { replayed: true }
            const stream = preparedEvents
              ? Stream.fromIterable(preparedEvents)
              : llm.stream({
                  ...streamInput,
                  timing: { request: () => timing.request(), arrived: () => arrived.arrived() },
                })

            ctx.lastEventAt = Date.now()
            yield* stream.pipe(
              Stream.tap((event) => {
                ctx.lastEventAt = Date.now()
                if (preparedEvents) return handleEvent(event)
                // Timed by when the event arrived, which llm.ts stamped while reading the provider;
                // the time spent here handling it is what the window must not count as generation.
                return Effect.gen(function* () {
                  const start = now()
                  if (timing.observe(event, arrived.take(event))) yield* recordFirstToken()
                  yield* handleEvent(event)
                  timing.busy(event, start, now())
                })
              }),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => {
                const error = Cause.squash(cause)
                // A tool already ran in this attempt. Replaying this request would run it again;
                // preserve its result and ask the next provider turn to continue from history.
                if (ctx.attemptExecuted) {
                  const parsed = parse(error)
                  const retry = SessionRetry.retryable(parsed, input.model.providerID)
                  const attempt = input.reconnectAttempt ?? 1
                  if (
                    !retry ||
                    !SessionRetry.connectionInterrupted(parsed) ||
                    attempt > SessionRetry.CONNECTION_CONTINUATION_MAX_RETRIES
                  )
                    return halt(error)
                  const wait = SessionRetry.delay(
                    attempt,
                    SessionV1.APIError.isInstance(parsed) ? parsed : undefined,
                  )
                  ctx.reconnect = true
                  return Verbose.log("provider.reconnect", () => ({
                    sessionID: ctx.sessionID,
                    providerID: input.model.providerID,
                    modelID: input.model.id,
                    attempt,
                    waitMs: wait,
                    reason: retry.message.length > 80 ? retry.message.slice(0, 77) + "..." : retry.message,
                  })).pipe(
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: "retry",
                        attempt,
                        message: retry.message,
                        action: retry.action,
                        next: Date.now() + wait,
                      }),
                    ),
                    Effect.andThen(Effect.sleep(Duration.millis(wait))),
                  )
                }
                return Effect.fail(error)
              },
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                // Decided to retry: the failed attempt's output goes now, before the wait, so the
                // message never shows it twice.
                set: (info) =>
                  discardAttempt().pipe(
                    Effect.andThen(
                      Verbose.log("provider.retry", () => ({
                        sessionID: ctx.sessionID,
                        providerID: input.model.providerID,
                        modelID: input.model.id,
                        attempt: info.attempt,
                        action: info.action?.reason,
                        waitMs: Math.max(0, info.next - Date.now()),
                        // What the status line shows the person, no more.
                        reason: info.message.length > 80 ? info.message.slice(0, 77) + "..." : info.message,
                      })),
                    ),
                    // From here the attempt only waits, so a model switch may end the wait. Set before
                    // the status says so: whoever sees the retry status can already switch.
                    Effect.andThen(
                      Effect.sync(() => {
                        ctx.retrying = true
                      }),
                    ),
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: "retry",
                        attempt: info.attempt,
                        // Which model the wait is for and, for a quota, when it resets.
                        message: `${modelLabel(input.model)}${info.quota ? ` quota exhausted until ${SessionRetry.clock(info.next)}` : ""}: ${info.message}`,
                        action: info.action,
                        next: info.next,
                      }),
                    ),
                    Effect.andThen(input.onRetry?.() ?? Effect.void),
                  ),
              }),
            ),
            Effect.raceFirst(switchedWhileWaiting),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.retargeted) return "switch"
          if (ctx.needsCompaction) return "compact"
          if (ctx.reconnect) return "reconnect"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      // Publishing a phase only when it actually changes: the status event is how every client
      // other than the TUI learns what is happening, and the TUI had to reverse-engineer it from
      // message parts. Emitting on every delta would be a flood for no extra information.
      const phase = Effect.fn("SessionProcessor.phase")(function* (
        next: "preparing" | "thinking" | "writing" | "tool" | "compacting",
        tool?: string,
      ) {
        if (input.compacting) {
          next = "compacting"
          tool = undefined
        }
        if (ctx.phase === next && ctx.phaseTool === tool) return
        ctx.phase = next
        ctx.phaseTool = tool
        yield* status.set(ctx.sessionID, {
          type: "busy",
          phase: next,
          ...(tool ? { tool } : {}),
          ...(ctx.step ? { step: ctx.step } : {}),
          since: Date.now(),
        })
      })

      const guardLoop = Effect.fn("SessionProcessor.guardLoop")(function* (input: { tool: string; input: unknown }) {
        const configured = (yield* config.get()).experimental?.loop_guard
        const bounds = LoopGuard.limits(configured)
        if (!bounds) return { type: "ok" } as LoopGuard.Decision
        // The `doom_loop` permission predates this guard and is how people already say "let it
        // repeat"; allowing it keeps meaning that, rather than becoming a dead config key. This
        // must ignore yolo's blanket allow: yolo means "skip permission prompts", not "disable the
        // loop guard" — only an explicit `doom_loop: allow` rule opts out.
        const agent = yield* agents.get(ctx.assistantMessage.agent)
        if (Permission.evaluateConfigured("doom_loop", input.tool, agent.permission).action === "allow") {
          return { type: "ok" } as LoopGuard.Decision
        }
        // Every step of a turn is its own assistant message, so looking at the current message
        // alone can never see a loop that spans steps — which is what a loop actually looks like.
        // Read back a bounded window and cut it at the last thing the user said; the synthetic
        // continuations the runtime writes for itself do not count as the user saying something.
        const recent = yield* session
          .messages({ sessionID: ctx.sessionID, limit: LOOP_WINDOW })
          .pipe(Effect.orElseSucceed(() => []))
        const decision = LoopGuard.assess({ parts: LoopGuard.turn(recent), next: input, limits: bounds })
        if (decision.type === "ok") return decision
        yield* guards.record({
          sessionID: ctx.sessionID,
          guard: "loop",
          action: decision.type === "stop" ? "stop" : "correct",
          subject: input.tool,
          detail: decision.message,
        })
        yield* Effect.logWarning("model is repeating itself", {
          sessionID: ctx.sessionID,
          tool: input.tool,
          streak: decision.streak,
          action: decision.type,
        })
        // A loop that survived its own correction ends the turn: continuing only spends money to
        // reach the same place. Unlike a denied permission this is not the user's call, so it does
        // not go through `shouldBreak`.
        if (decision.type === "stop") {
          ctx.blocked = true
          ctx.guardStop = decision.summary
        }
        return decision
      })

      return {
        /** Read by the turn loop's watchdog: silence here is what a stall looks like. */
        get lastEventAt() {
          return ctx.lastEventAt
        },
        get activeToolCount() {
          return Object.keys(ctx.toolcalls).length
        },
        get guardStop() {
          return ctx.guardStop
        },
        get overflow() {
          return ctx.overflow
        },
        get exhausted() {
          return ctx.exhausted
        },
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        guardLoop,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

/** How the person knows the model: its provider and name, as the status line and errors name it. */
function modelLabel(model: Provider.Model) {
  return `${model.providerID} · ${model.name || model.id}`
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionGuardLog.node,
    Session.node,
    Config.node,
    Snapshot.node,
    Agent.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    OperationHookBridge.node,
    Database.node,
  ],
})

export * as SessionProcessor from "./processor"
