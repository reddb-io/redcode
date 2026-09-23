import { Intelligence } from "../../intelligence"
import { ProviderRouter } from "../../provider/router"
import { Semantic } from "../../semantic"
import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  TransportReason,
  contextOverflowNumbers,
  isContextOverflowFailure,
  type LLMRequest,
  type Model,
  type ProviderErrorEvent,
} from "@reddb-io/redcode-llm"
import { ModelLimit } from "../../model-limit"
import {
  Cause,
  Clock,
  DateTime,
  Duration,
  Effect,
  FiberSet,
  Layer,
  Option,
  Queue,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { Flag } from "../../flag/flag"
import { Verbose } from "../../observability/verbose"
import { HumanWait } from "../human-wait"
import { PromptCacheDiagnostics } from "../prompt-cache-diagnostics"
import { LoopGuard } from "../loop-guard"
import { SessionRetry } from "../retry"
import { SessionStall } from "../stall"
import { ToolDeadline } from "../tool-deadline"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { DesignContext } from "../../design/context"
import { DesignRenderer } from "../../design/renderer"
import { DesignStore } from "../../design/store"
import { SkillGuidance } from "../../skill/guidance"
import { SkillV2 } from "../../skill"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { NativeToolSearch } from "../../tool/native-tool-search"
import { ToolSearch } from "../../tool/tool-search"
import { Monitor } from "../../monitor"
// `parks` is a rule about a monitor's options, not part of the runtime service.
import { Monitor as MonitorSchema } from "@reddb-io/redcode-schema/monitor"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { CompactionGuardStore } from "../compaction-guard-store"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionGuardTripTable } from "../sql"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionMessage } from "../message"
import { ToolInterrupted } from "../tool-interrupted"
import { SessionTodo } from "../todo"
import { SessionGoal } from "../goal"
import { SessionGoalCompletion } from "../goal-completion"
import { SessionPlan } from "../plan"
import { SessionProgressContext } from "../progress-context"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher, usageTokens } from "./publish-llm-event"
import { GenerationTiming } from "../generation-timing"
import { RequestExecutor } from "@reddb-io/redcode-llm/route"

import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { HookV2 } from "../../hook"

const RESPONSE_REPAIR = "[system:response-quality-repair]"

/** Events that only carry content: publishing them persists what the provider sent and runs nothing. */
const CONTENT_EVENTS = new Set([
  "step-start",
  "text-start",
  "text-delta",
  "text-end",
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
  "tool-input-start",
  "tool-input-delta",
])

const prefixLength = <A>(items: ReadonlyArray<A>, keep: (item: A) => boolean) => {
  const index = items.findIndex((item) => !keep(item))
  return index < 0 ? items.length : index
}

// Evaluator history contains text and references, never attachment payloads or provider metadata.
const intelligenceHistory = (messages: ReadonlyArray<SessionMessage.Message>) =>
  messages.map((message) => ({
    id: message.id,
    type: message.type,
    text:
      "text" in message
        ? message.text
        : message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
          : message.type === "compaction"
            ? `${message.summary}\n${message.recent}`
            : message.type === "shell"
              ? `${message.command}\n${message.output}`
              : undefined,
    files:
      message.type === "user"
        ? message.files?.map((file, index) => ({
            name: file.name,
            mime: file.mime,
            description: file.description,
            reference: `${message.id}/files/${index}`,
            contentReviewed: false,
          }))
        : undefined,
    tools:
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool"
              ? [
                  {
                    callID: part.id,
                    tool: part.name,
                    status: part.state.status,
                    reference: `${message.id}/${part.id}/result`,
                  },
                ]
              : [],
          )
        : undefined,
  }))

const responseToolResults = (messages: ReadonlyArray<SessionMessage.Message>) => {
  const lastUser = messages.findLastIndex((message) => message.type === "user")
  return messages.slice(lastUser + 1).flatMap((message) =>
    message.type === "assistant"
      ? message.content.flatMap((part) => {
          if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return []
          return [
            {
              messageID: message.id,
              callID: part.id,
              tool: part.name,
              status: part.state.status,
              input: Intelligence.evidence(part.state.input, {
                reference: `${message.id}/${part.id}/input`,
                limit: 2000,
              }),
              output: Intelligence.evidence(part.state, { reference: `${message.id}/${part.id}/result`, limit: 4000 }),
            },
          ]
        })
      : [],
  )
}

/** The latest user message follows a turn that was cancelled or cut off with tool calls unsettled. */
const followsInterruptedTurn = (context: readonly SessionMessage.Message[]) => {
  const index = context.findLastIndex((message) => message.type === "user")
  if (index < 0) return false
  const previous = context.slice(0, index).findLast((message) => message.type === "assistant")
  if (previous?.type !== "assistant") return false
  return (
    previous.error?.message === "Provider turn interrupted" ||
    previous.content.some(
      (item) =>
        item.type === "tool" && item.state.status === "error" && item.state.error.message === ToolInterrupted.RESULT,
    )
  )
}

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@reddb-io/redcode-llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const designs = yield* DesignStore.Service
    const renderer = yield* DesignRenderer.Service
    const skillGuidance = yield* SkillGuidance.Service
    const skills = yield* SkillV2.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const hooks = yield* HookV2.Service
    const todos = yield* SessionTodo.Service
    const goals = yield* SessionGoal.Service
    const completion = yield* SessionGoalCompletion.Service
    const plans = yield* SessionPlan.Service
    const monitors = yield* Monitor.Service
    const db = (yield* Database.Service).db
    const limits = yield* ModelLimit.Service
    const intelligence = yield* Intelligence.Service
    const semantic = yield* Semantic.Service
    const configEntriesAtStart = yield* config.entries()
    const compaction = SessionCompaction.make({
      intelligence,
      semantic,
      scope: yield* Scope.Scope,
      latestUser: (sessionID, beforeSeq) => SessionHistory.latestUser(db, sessionID, beforeSeq).pipe(Effect.orDie),
      events,
      llm,
      config: configEntriesAtStart,
      beforeCompact: ({ sessionID, reason }) =>
        hooks.run({ event: "PreCompact", session_id: sessionID, matcher: reason }),
      guardStore: CompactionGuardStore.make(db),
      limits,
    })
    /**
     * What a provider's refusal teaches about its limit, kept so the next request from the model
     * is sized by it instead of repeating the refusal.
     */
    // The provider's count for the last request of a session and our estimate for it, so the
    // next request is projected from that count plus what it gained since.
    const anchors = new Map<SessionSchema.ID, { counted: number; estimate: number }>()
    const promptCache = PromptCacheDiagnostics.tracker()
    const outputOf = (model: Model, request: LLMRequest) =>
      request.generation?.maxTokens ?? model.route.defaults.limits?.output ?? 0
    const carriesMedia = (request: LLMRequest) =>
      request.messages.some((message) => message.content.some((part) => part.type === "media"))
    const learnLimit = Effect.fnUntraced(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly model: Model
      readonly request: LLMRequest
      readonly failure: unknown
    }) {
      const failure = input.failure
      const text =
        failure instanceof LLMError
          ? [failure.reason.message, "http" in failure.reason ? failure.reason.http?.body : undefined]
              .filter((part): part is string => typeof part === "string" && part.length > 0)
              .join("\n")
          : LLMEvent.is.providerError(failure as LLMEvent)
            ? (failure as ProviderErrorEvent).message
            : ""
      const numbers = contextOverflowNumbers(text)
      if (!numbers) return
      const providerID = input.model.provider ?? ""
      const observed = ModelLimit.fromNumbers({
        numbers,
        output: outputOf(input.model, input.request),
        // The estimate of a request with images or files in it calibrates nothing.
        estimated: carriesMedia(input.request) ? undefined : compaction.sizeOf(input.request),
        declared: SessionCompaction.declaredLimit(configEntriesAtStart, providerID, input.model.id),
        message: text.split("\n")[0] ?? text,
      })
      if (!observed) return
      yield* limits.learn(providerID, input.model.id, observed)
      yield* Effect.logInfo("learned provider input limit", {
        sessionID: input.sessionID,
        providerID,
        modelID: input.model.id,
        limit: observed.limit,
        includesOutput: observed.includesOutput ?? false,
        counted: observed.counted,
        estimated: observed.estimated,
        ratio: observed.ratio,
      })
    })
    /** A request the provider accepted above the lesson raises the lesson. */
    const raiseLimit = Effect.fnUntraced(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly model: Model
      readonly request: LLMRequest
      readonly accepted: number
    }) {
      const providerID = input.model.provider ?? ""
      const observed = yield* limits.get(
        providerID,
        input.model.id,
        SessionCompaction.declaredLimit(configEntriesAtStart, providerID, input.model.id),
      )
      if (!observed) return
      const raised = ModelLimit.raised(observed, input.accepted, outputOf(input.model, input.request))
      if (!raised) return
      yield* limits.learn(providerID, input.model.id, raised)
      yield* Effect.logInfo("provider accepted more than its learned limit; raised it", {
        sessionID: input.sessionID,
        providerID,
        modelID: input.model.id,
        accepted: input.accepted,
        limit: raised.limit,
      })
    })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: ToolInterrupted.RESULT },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    // A provider retry in progress: which attempt this is, and the goal turn the first attempt counted.
    type Retry = { readonly attempt: number; readonly goalID: string | undefined }
    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number; readonly retry?: Retry }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number; readonly retry?: Retry }
      // A retryable provider failure; wait, then replay an empty attempt or continue durable output.
      | {
          readonly _tag: "RetryProvider"
          readonly step: number
          readonly retry: Retry
          readonly failure: LLMError
          readonly message: string
        }
      // The provider refused native tool search; replay the same step with the client-side tool.
      | { readonly _tag: "RetryWithoutNativeSearch"; readonly step: number; readonly retry: Retry }
    // Tags the stall watchdog's own failure so it is never mistaken for a retryable transport error.
    const stallKind = "session-stall"

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number, retry?: Retry) =>
      new TurnTransitionError({ _tag: "ContinueAfterCompaction", step, retry })
    const continueAfterOverflowCompaction = (step: number, retry?: Retry) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step, retry })

    // Session status, published like the legacy runtime's `SessionStatus.set` so clients see busy,
    // retry and idle for v2 sessions too. Live, not durable: legacy status is not durable either.
    const busy = new Set<SessionSchema.ID>()
    const setBusy = (
      sessionID: SessionSchema.ID,
      status: {
        readonly phase: "preparing" | "thinking" | "writing" | "tool"
        readonly tool?: string
        readonly step: number
      },
    ) =>
      Effect.gen(function* () {
        busy.add(sessionID)
        yield* events.publish(SessionStatusEvent.Status, {
          sessionID,
          status: { type: "busy", ...status, since: yield* Clock.currentTimeMillis },
        })
      })
    const setIdle = (sessionID: SessionSchema.ID) =>
      Effect.suspend(() =>
        busy.delete(sessionID)
          ? events
              .publish(SessionStatusEvent.Status, { sessionID, status: { type: "idle" } })
              .pipe(Effect.andThen(events.publish(SessionStatusEvent.Idle, { sessionID })), Effect.ignore)
          : Effect.void,
      )

    const waitToRetry = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      transition: Extract<TurnTransition, { readonly _tag: "RetryProvider" }>,
    ) {
      const attempt = transition.retry.attempt
      const wait = SessionRetry.delayLLM(attempt, transition.failure)
      busy.add(sessionID)
      yield* events.publish(SessionStatusEvent.Status, {
        sessionID,
        status: {
          type: "retry",
          attempt,
          message: transition.message,
          next: (yield* Clock.currentTimeMillis) + wait,
        },
      })
      yield* Effect.logWarning("Retrying provider turn", { sessionID, attempt, wait })
      yield* Effect.sleep(Duration.millis(wait))
    })

    const recordGuard = (input: {
      readonly sessionID: SessionSchema.ID
      readonly guard: string
      readonly action: "warn" | "correct" | "stop"
      readonly subject?: string
      readonly detail: string
    }) =>
      Effect.gen(function* () {
        yield* db
          .insert(SessionGuardTripTable)
          .values({
            id: crypto.randomUUID(),
            session_id: input.sessionID,
            guard: input.guard,
            action: input.action,
            subject: input.subject,
            detail: input.detail,
          })
          .run()
          .pipe(Effect.orDie)
        yield* events.publish(SessionEvent.Guard.Tripped, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          guard: input.guard,
          action: input.action,
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          detail: input.detail,
        })
      })

    const pauseGoal = (sessionID: SessionSchema.ID, reason: string) =>
      Effect.gen(function* () {
        const goal = yield* goals.get(sessionID).pipe(Effect.orDie)
        if (goal?.status === "active" || goal?.status === "waiting")
          yield* goals.save(goal, { ...goal, status: "paused", reason }).pipe(Effect.orDie)
      })

    // The shared loop guard over projected v2 history: repeated calls and repeated progress.
    const guardLoop = Effect.fn("SessionRunner.guardLoop")(function* (
      sessionID: SessionSchema.ID,
      permissions: PermissionV2.Ruleset | undefined,
      tool: string,
      input: unknown,
      limits: LoopGuard.Limits | undefined,
    ) {
      // `experimental.loop_guard: false` turns the guard off, as in legacy.
      if (!limits) return { type: "ok" } as LoopGuard.Decision
      // `doom_loop: allow` is how people already say "let it repeat"; keep meaning that.
      if (PermissionV2.evaluate("doom_loop", tool, permissions ?? []).effect === "allow")
        return { type: "ok" } as LoopGuard.Decision
      // Like legacy: history that cannot be read means no streak, never a failed tool.
      const messages = yield* getContext(sessionID).pipe(Effect.orElseSucceed(() => []))
      const last = messages.findLastIndex((message) => message.type === "user")
      const parts = messages.slice(last + 1).flatMap((message): LoopGuard.Part[] =>
        message.type !== "assistant"
          ? []
          : message.content.flatMap((item): LoopGuard.Part[] => {
              if (item.type === "text") return [{ type: "text", text: item.text }]
              if (item.type !== "tool" || item.provider?.executed === true) return []
              if (item.state.status === "completed")
                return [
                  {
                    type: "tool",
                    tool: item.name,
                    state: {
                      status: "completed",
                      input: item.state.input,
                      output: JSON.stringify([item.state.content, item.state.structured]),
                    },
                  },
                ]
              if (item.state.status === "error")
                return [
                  {
                    type: "tool",
                    tool: item.name,
                    state: { status: "error", input: item.state.input, error: item.state.error.message },
                  },
                ]
              return []
            }),
      )
      const decision = LoopGuard.assess({ parts, next: { tool, input }, limits })
      if (decision.type === "ok") return decision
      yield* recordGuard({
        sessionID,
        guard: "loop",
        action: decision.type === "stop" ? "stop" : "correct",
        subject: tool,
        detail: decision.message,
      })
      yield* Effect.logWarning("model is repeating itself", { sessionID, tool, streak: decision.streak })
      return decision
    })

    // The legacy tool deadline: a wedged tool becomes an ordinary tool failure, minus human wait time.
    const settleBounded = (
      sessionID: SessionSchema.ID,
      tool: string,
      callID: string,
      settle: Effect.Effect<ToolRegistry.Settlement, ToolOutputStore.Error>,
      configured: number | false | undefined,
    ): Effect.Effect<ToolRegistry.Settlement, ToolOutputStore.Error> => {
      const ms = ToolDeadline.deadlineMs({ tool, configured })
      if (ms === undefined) return settle
      const expired = ToolDeadline.message({ tool, ms })
      return Effect.suspend(() => {
        HumanWait.claim(sessionID, callID)
        return ToolDeadline.guard(() => settle, {
          tool,
          ms,
          waitedMs: (now) => HumanWait.waited(sessionID, callID, now),
          onExpire: recordGuard({ sessionID, guard: "tool_timeout", action: "stop", subject: tool, detail: expired }),
        })
      }).pipe(
        Effect.catchDefect((defect) =>
          defect instanceof Error && defect.message === expired
            ? Effect.succeed<ToolRegistry.Settlement>({ result: { type: "error", value: expired } })
            : Effect.die(defect),
        ),
        Effect.ensuring(Effect.sync(() => HumanWait.forget(sessionID, callID))),
      )
    }

    const loadSystemContext = (agent: AgentV2.Selection, sessionID: SessionSchema.ID) =>
      Effect.all(
        [
          systemContext.load(),
          skillGuidance.load(agent),
          referenceGuidance.load(),
          DesignContext.load(sessionID).pipe(Effect.provideService(DesignStore.Service, designs)),
          SessionProgressContext.load(sessionID).pipe(
            Effect.provideService(SessionGoal.Service, goals),
            Effect.provideService(SessionPlan.Service, plans),
            Effect.provideService(SessionTodo.Service, todos),
          ),
        ],
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.map(SystemContext.combine))

    const reportIntelligenceFailure = (sessionID: SessionSchema.ID, operation: string, message: string) =>
      Effect.gen(function* () {
        const detail = `System One ${operation} unavailable: ${message}. Completion has not been verified.`
        yield* recordGuard({ sessionID, guard: "intelligence", action: "warn", subject: operation, detail })
        yield* events.publish(SessionEvent.Synthetic, {
          sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          text: detail,
        })
      })

    const promptAttempts = new Map<SessionSchema.ID, Map<string, Intelligence.Evaluation | undefined>>()

    const evaluateIntelligence = Effect.fn("SessionRunner.evaluateIntelligence")(function* (
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
            reportIntelligenceFailure(SessionSchema.ID.make(input.sessionID), input.operation, error.message).pipe(
              Effect.as(undefined),
            ),
          ),
        )
      attempts?.set(evaluation?.fingerprint ?? hash, evaluation)
      return evaluation
    })

    const reviewResponse = Effect.fn("SessionRunner.reviewResponse")(function* (
      sessionID: SessionSchema.ID,
      attempt: number,
    ) {
      const entries = yield* SessionHistory.entriesForRunner(db, sessionID, 0).pipe(Effect.orDie)
      const candidate = entries.map((entry) => entry.message).findLast((message) => message.type === "assistant")
      if (!candidate) return undefined
      const text = candidate.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
      if (!text.trim()) return undefined
      const messages = entries.map((entry) => entry.message)
      const requests = messages
        .filter((message) => message.type === "user")
        .map((message) => ({ id: message.id, text: message.text }))
      const toolResults = responseToolResults(messages)
      return yield* evaluateIntelligence({
        sessionID,
        operation: "response_quality",
        kind: "gate",
        subjectID: requests.at(-1)?.id,
        candidateID: candidate.id,
        attempt,
        sources: {
          requests: Intelligence.evidence(requests, { reference: `${sessionID}/requests`, limit: 3000 }),
          latest_request: Intelligence.evidence(requests.at(-1), { reference: requests.at(-1)?.id, limit: 4000 }),
          checkpoints: Intelligence.evidence(messages.filter((message) => message.type === "compaction").slice(-1), {
            reference: `${sessionID}/checkpoint`,
            limit: 3000,
          }),
          tasks: Intelligence.evidence(yield* todos.get(sessionID), { reference: `${sessionID}/tasks`, limit: 3000 }),
          goal: Intelligence.evidence(yield* goals.get(sessionID), { reference: `${sessionID}/goal`, limit: 2000 }),
          tool_results: Intelligence.evidence(toolResults, { reference: `${sessionID}/tool-results`, limit: 8000 }),
        },
        candidate: Intelligence.evidence(text, { reference: candidate.id, limit: 6000 }),
        questions: Intelligence.responseQuestions,
      }).pipe(
        Effect.catchTag("IntelligenceError", (error) =>
          reportIntelligenceFailure(sessionID, "response_quality", error.message).pipe(Effect.as(undefined)),
        ),
      )
    })

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
      retry?: Retry,
      withoutNative?: boolean,
    ) {
      const attempt = retry?.attempt ?? 1
      // Every call is one provider attempt: a retry or a native search fallback measures from scratch,
      // and its local preparation starts here.
      const timing = GenerationTiming.recorder({ created: Date.now() })
      timing.attempt()
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent, session.id), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      let promoted = 0
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ??
        (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent, session.id), session.id))
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const lastContext = context.at(-1)
      const responseRepair = lastContext?.type === "synthetic" && lastContext.text.startsWith(RESPONSE_REPAIR)
      const latestUser = context.findLast((message) => message.type === "user")
      // Reconcile visible prompts too: a resume, monitor promotion or prior unavailable
      // evaluator must not leave a durable user input permanently unclassified.
      const users = context.filter((message) => message.type === "user")
      const attempted = promptAttempts.get(session.id) ?? new Map<string, Intelligence.Evaluation | undefined>()
      promptAttempts.set(session.id, attempted)
      const goal = yield* goals.get(session.id).pipe(Effect.orDie)
      const classificationState = {
        mode: agent.id,
        goal: Intelligence.evidence(
          goal
            ? {
                objective: goal.objective,
                criteria: goal.criteria,
                gates: goal.gates,
                stopAfter: goal.stopAfter,
                executePlan: goal.executePlan,
                status: goal.status,
                reason: goal.reason,
              }
            : undefined,
          {
            reference: `${session.id}/goal`,
            limit: 4000,
          },
        ),
        plan: Intelligence.evidence(SessionPlan.guidance(yield* plans.list(session.id)), {
          reference: `${session.id}/plans`,
          limit: 6000,
        }),
      }
      const availableSkills = agent.info
        ? SkillV2.available(yield* skills.list(), agent.info)
            .flatMap((skill) =>
              skill.description === undefined ? [] : [{ name: skill.name, description: skill.description }],
            )
            .toSorted((left, right) => left.name.localeCompare(right.name))
        : []
      const assessments = yield* Effect.forEach(
        users,
        (message) =>
          Effect.gen(function* () {
            const preceding = context.slice(0, context.indexOf(message))
            const evaluation = yield* evaluateIntelligence(
              {
                sessionID: session.id,
                operation: "prompt_classification",
                kind: "classification",
                subjectID: message.id,
                sources: {
                  text: Intelligence.evidence(message.text, { reference: message.id, limit: 12000 }),
                  files: Intelligence.evidence(
                    message.files?.map((file, index) => ({
                      name: file.name,
                      mime: file.mime,
                      description: file.description,
                      reference: `${message.id}/files/${index}`,
                      contentReviewed: false,
                    })),
                    { reference: `${message.id}/files`, limit: 2000 },
                  ),
                  session: classificationState,
                  history: Intelligence.evidence(
                    {
                      messages: intelligenceHistory(preceding.slice(-12)),
                      omittedMessages: Math.max(0, preceding.length - 12),
                    },
                    {
                      reference: `${session.id}/before/${message.id}`,
                      limit: 12000,
                    },
                  ),
                },
                questions: Intelligence.promptQuestionsFor(availableSkills),
              },
              attempted,
            ).pipe(
              Effect.catchTag("IntelligenceError", (error) =>
                reportIntelligenceFailure(session.id, "prompt_classification", error.message).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
            return evaluation
          }),
        { concurrency: 2 },
      )
      const assessment = assessments.find((evaluation) => evaluation?.subjectID === latestUser?.id)
      const assessmentContext =
        Intelligence.promptContext(assessment) ??
        (assessment?.decision === "unavailable"
          ? `System One prompt classification unavailable (${assessment.id}). Use the original user request and conversation; no classification has been verified.`
          : undefined)
      const skillContext = Intelligence.skillContext(assessment)
      const batch = context.findLast((message) => message.type === "assistant")
      const settledTools =
        batch && (!latestUser || context.indexOf(batch) > context.indexOf(latestUser))
          ? responseToolResults([batch])
          : []
      const priorAttempts = attempted.size
      const toolReview =
        settledTools.length && batch
          ? yield* Effect.gen(function* () {
              const evaluation = yield* evaluateIntelligence(
                {
                  sessionID: session.id,
                  operation: "tool_usage",
                  kind: "gate",
                  subjectID: latestUser?.id,
                  candidateID: batch.id,
                  sources: {
                    request: Intelligence.evidence(latestUser ? intelligenceHistory([latestUser])[0] : undefined, {
                      reference: latestUser?.id,
                      limit: 12000,
                    }),
                    session: classificationState,
                  },
                  candidate: Intelligence.evidence(settledTools, {
                    reference: `${session.id}/${batch.id}/tools`,
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
                attempted,
              ).pipe(
                Effect.catchTag("IntelligenceError", (error) =>
                  reportIntelligenceFailure(session.id, "tool_usage", error.message).pipe(Effect.as(undefined)),
                ),
              )
              return evaluation
            })
          : undefined
      const toolContext =
        toolReview && toolReview.decision !== "accepted"
          ? `System One tool review ${toolReview.decision} (${toolReview.id}): ${toolReview.issues.join(", ")}. Verify missing evidence and correct failed work within the user's scope and existing permissions. An unavailable or inconclusive evaluation is not approval.`
          : undefined
      if (toolContext && attempted.size !== priorAttempts)
        yield* recordGuard({
          sessionID: session.id,
          guard: "intelligence",
          action: "warn",
          subject: "tool_usage",
          detail: toolContext,
        })
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      // Read per turn, like legacy, so an edited redcode.json applies from the next turn.
      const configEntries = yield* config.entries()
      const experimental = Config.latest(configEntries, "experimental")
      const searchConfig = experimental?.tool_search
      const native = withoutNative ? undefined : NativeToolSearch.detect({ model, config: searchConfig })
      const deferral: ToolRegistry.Deferral = {
        ...(searchConfig ? { config: searchConfig } : {}),
        servers: Object.keys(Config.latest(configEntries, "mcp")?.servers ?? {}),
        // Fail closed: a Design store that cannot be read must not be mistaken for "no Design
        // context", which would defer every Design tool in the middle of a Design session.
        designContext: yield* designs.list(session.id).pipe(
          Effect.map((documents) => documents.length > 0),
          Effect.orElseSucceed(() => true),
        ),
        tripped: ToolSearch.trippedInHistory(context),
        loaded: ToolSearch.loadedFromHistory(context, ToolSearch.namesInHistory(context)),
        ...(native ? { native } : {}),
      }
      const toolMaterialization = isLastStep
        ? undefined
        : yield* tools.materialize({ permissions: agent.info?.permissions, deferral })
      const mcpCatalog = toolMaterialization?.mcpTools ?? []
      const selectionID = `mcp-selection:${Intelligence.fingerprint({ tools: mcpCatalog, request: latestUser?.id, batch: batch?.id })}`
      const mcpSelection =
        mcpCatalog.length && latestUser
          ? yield* Effect.gen(function* () {
              const evaluation = yield* evaluateIntelligence(
                {
                  sessionID: session.id,
                  operation: "tool_usage",
                  kind: "classification",
                  subjectID: latestUser.id,
                  candidateID: selectionID,
                  sources: {
                    request: Intelligence.evidence(latestUser.text, { reference: latestUser.id, limit: 6000 }),
                    session: classificationState,
                    history: Intelligence.evidence(intelligenceHistory(context.slice(-6)), {
                      reference: `${session.id}/recent`,
                      limit: 6000,
                    }),
                    tool_results: Intelligence.evidence(settledTools, { reference: batch?.id, limit: 4000 }),
                  },
                  questions: Intelligence.toolQuestionsFor(mcpCatalog),
                },
                attempted,
              ).pipe(
                Effect.catchTag("IntelligenceError", (error) =>
                  reportIntelligenceFailure(session.id, "MCP selection", error.message).pipe(Effect.as(undefined)),
                ),
              )
              return evaluation
            })
          : undefined
      const mcpContext = Intelligence.toolContext(mcpSelection)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        http: {
          headers: {
            "x-session-affinity": session.id,
            "X-Session-Id": session.id,
            ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
            // Only a RedRouter this process already detected (on connect, by the legacy runner or
            // by System One setup); the runner never waits on a probe. A combo that picks its member
            // per request gets System One's hint and chooses the model; the runner never switches it.
            ...ProviderRouter.requestHeaders(ProviderRouter.known(model.route.endpoint.baseURL ?? ""), {
              decision: mcpContext || skillContext ? false : undefined,
              hint: Intelligence.routerHint(assessment, mcpSelection),
              model: Config.latest(configEntries, "providers")?.[model.provider ?? ""]?.models?.[model.id]?.router,
            }),
          },
        },
        providerOptions: {
          openai: { promptCacheKey },
          // Native search: the provider carries the deferred definitions and its own search tool.
          ...(toolMaterialization?.native === "anthropic" ? { anthropic: { toolSearch: "bm25" } } : {}),
        },
        system: [agent.info?.system, system.baseline, assessmentContext, skillContext, toolContext, mcpContext]
          .concat(
            toolMaterialization?.definitions.some((tool) => tool.name === "todowrite") ? SessionTodo.guidance : [],
          )
          // The index of tools behind `tool_search` is sent as its own system part rather than in
          // the tool's description, so the tools block keeps its cached bytes when servers change.
          .concat(toolMaterialization?.toolIndex ?? [])
          .concat(
            responseRepair
              ? [
                  "Correct the evaluated response and any unfinished work it reveals. Use tools when needed to obtain missing evidence or finish already authorized work. Preserve existing permissions and scope; evaluation never authorizes new actions. Do not repeat completed work or claim verification without evidence.",
                ]
              : [],
          )
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [
          ...toLLMMessages(context, model),
          ...(followsInterruptedTurn(context)
            ? [Message.user(`<system-reminder>\n${ToolInterrupted.NOTE}\n</system-reminder>`)]
            : []),
          ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : []),
        ],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      const preflight = yield* compaction.compactIfNeeded({
        sessionID: session.id,
        entries,
        model,
        request,
        anchor: anchors.get(session.id),
      })
      if (preflight.action === "compacted") {
        // The count anchored the request that was compacted away, not the one being rebuilt.
        anchors.delete(session.id)
        return yield* Effect.die(continueAfterCompaction(currentStep, retry))
      }
      if (preflight.action === "refuse") {
        // Not sent: the provider would refuse it, and compaction had its chances. Reported as the
        // step's failure, with what to do about it.
        yield* recordGuard({ sessionID: session.id, guard: "compaction", action: "stop", detail: preflight.reason })
        yield* pauseGoal(session.id, preflight.reason)
        yield* createLLMEventPublisher(events, {
          sessionID: session.id,
          agent: agent.id,
          model: {
            id: ModelV2.ID.make(model.id),
            providerID: ProviderV2.ID.make(model.provider ?? ""),
            ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
          },
        }).failAssistant(preflight.reason)
        return {
          needsContinuation: false,
          todoEligible: false,
          step: currentStep,
          goalStopped: false,
          goalID: undefined,
          failed: true,
          tokens: 0,
        }
      }
      // A retry replays the provider turn the goal already counted: an outage is not budget exhaustion.
      const goalID = retry ? retry.goalID : yield* goals.beginTurn(sessionID).pipe(Effect.orDie)
      if (goalID === false)
        return {
          needsContinuation: false,
          todoEligible: false,
          step: currentStep,
          goalStopped: true,
          goalID: undefined,
          failed: false,
          tokens: 0,
        }
      yield* setBusy(session.id, { phase: "preparing", step: currentStep })
      // Stall watchdog: silence with no local tool in flight is a stall; unattended runs end it.
      let lastEventAt = yield* Clock.currentTimeMillis
      let activeTools = 0
      let loopStop: string | undefined
      // Read per turn, like legacy, so an edited redcode.json applies from the next turn.
      const loopLimits = LoopGuard.limits(experimental?.loop_guard)
      const stallLimits = SessionStall.limits(experimental?.turn_stall, {
        attended: SessionStall.attended(Flag.REDCODE_CLIENT),
      })
      const watchdog = Effect.gen(function* () {
        let warned = false
        while (true) {
          yield* Effect.sleep(Duration.millis(SessionStall.pollMs(stallLimits)))
          const decision = SessionStall.decide({
            quietMs: (yield* Clock.currentTimeMillis) - lastEventAt,
            activeToolCount: activeTools,
            permissionPending: false,
            limits: stallLimits,
          })
          if (decision.type === "working") {
            warned = false
            continue
          }
          if (decision.type === "warn") {
            if (!warned)
              yield* recordGuard({
                sessionID: session.id,
                guard: "stall",
                action: "warn",
                detail: SessionStall.warning(decision.quietMs, stallLimits),
              })
            warned = true
            continue
          }
          yield* recordGuard({
            sessionID: session.id,
            guard: "stall",
            action: "stop",
            detail: `stopped: ${decision.reason}`,
          })
          yield* pauseGoal(session.id, `stalled: ${decision.reason}`)
          return yield* new LLMError({
            module: "SessionRunner",
            method: "stall",
            reason: new TransportReason({ message: `stopped: ${decision.reason}`, kind: stallKind }),
          })
        }
      })
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
        messageDisplay: (message) => hooks.run({ event: "MessageDisplay", session_id: session.id, message }),
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      const completionTools: Effect.Effect<void, ToolOutputStore.Error>[] = []
      let reportedTokens: ReturnType<typeof usageTokens> | undefined
      let overflowFailure: ProviderErrorEvent | undefined
      // Under --verbose only: which part of the request, if any, broke the cached prefix of the previous one.
      yield* Verbose.log("prompt.cache", () => ({
        sessionID: session.id,
        ...promptCache(session.id, PromptCacheDiagnostics.fromRequest(request)),
      }))
      // Stamped here in case the client makes no HTTP attempt of its own; the executor stamps each one.
      timing.request()
      const upstream = llm.stream(request)
      // A reader fiber stamps output as it arrives from the provider and queues it, and keeps reading
      // while the handler below publishes, runs display hooks or waits for a sibling tool's
      // publication. Tools start in the handler, so reading ahead never starts one early.
      const arrivals = yield* Queue.unbounded<
        { readonly event: LLMEvent; readonly at: number },
        LLMError | Cause.Done
      >()
      const reader = upstream.pipe(
        Stream.runForEach((event) => {
          // Usage counts once it is received, even if cancellation wins before the handler gets to it.
          if (event.type === "step-finish" && !reportedTokens) reportedTokens = usageTokens(event.usage)
          return Queue.offer(arrivals, { event, at: performance.now() })
        }),
        Effect.andThen(Queue.end(arrivals)),
        Effect.catchCause((cause) => Queue.failCause(arrivals, cause)),
        // The executor retries 429 and 5xx answers itself, after a backoff: time from the last attempt.
        Effect.provideService(RequestExecutor.AttemptStarted, () => timing.request()),
      )
      // Output that arrived but was not handled when the turn is interrupted is still content the
      // provider sent: it is published, as it was before reading ahead, up to anything that would act.
      const publishArrived = Queue.clear(arrivals).pipe(
        Effect.orElseSucceed(() => []),
        Effect.flatMap((left) =>
          Effect.forEach(
            left.slice(
              0,
              prefixLength(left, (item) => CONTENT_EVENTS.has(item.event.type)),
            ),
            (item) => (publisher.hasProviderError() ? Effect.void : publish(item.event)),
            { discard: true },
          ),
        ),
      )
      const providerStream = Effect.gen(function* () {
        yield* Effect.forkChild(reader)
        return yield* Stream.fromQueue(arrivals).pipe(
          Stream.runForEach(({ event, at }) => {
            const handling = performance.now()
            timing.observe(event, at)
            return Effect.gen(function* () {
              lastEventAt = yield* Clock.currentTimeMillis
              if (overflowFailure || publisher.hasProviderError()) return
              if (LLMEvent.is.providerError(event)) {
                if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                  overflowFailure = event
                  return
                }
              }
              yield* publish(event)
              if (event.type !== "tool-call" || event.providerExecuted) return
              if (!toolMaterialization) {
                yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
                return
              }
              needsContinuation = true
              const assistantMessageID = yield* publisher.assistantMessageID(event.id)
              const execute = Effect.uninterruptibleMask((restore) =>
                restore(
                  Effect.gen(function* () {
                    const pre = yield* hooks.run({
                      event: "PreToolUse",
                      matcher: HookV2.toolName(event.name),
                      session_id: session.id,
                      tool_name: HookV2.toolName(event.name),
                      tool_input: event.input,
                    })
                    const denied = !pre.continue || pre.decision === "deny"
                    // Asked before the call runs: a correction reaches the model as this tool's result.
                    const loop = denied
                      ? undefined
                      : yield* guardLoop(
                          session.id,
                          agent.info?.permissions,
                          event.name,
                          pre.updatedInput ?? event.input,
                          loopLimits,
                        )
                    if (loop?.type === "stop") loopStop ??= loop.summary
                    if (!denied && loop?.type === "ok")
                      yield* setBusy(session.id, { phase: "tool", tool: event.name, step: currentStep })
                    const settlement = denied
                      ? { result: { type: "error" as const, value: pre.reason ?? "Tool use denied by hook" } }
                      : loop && loop.type !== "ok"
                        ? { result: { type: "error" as const, value: loop.message } }
                        : yield* settleBounded(
                            session.id,
                            event.name,
                            event.id,
                            toolMaterialization.settle({
                              sessionID: session.id,
                              agent: agent.id,
                              assistantMessageID,
                              call: pre.updatedInput === undefined ? event : { ...event, input: pre.updatedInput },
                            }),
                            experimental?.tool_timeout,
                          )
                    yield* hooks.run({
                      event: settlement.result.type === "error" ? "PostToolUseFailure" : "PostToolUse",
                      matcher: HookV2.toolName(event.name),
                      session_id: session.id,
                      tool_name: HookV2.toolName(event.name),
                      tool_input: pre.updatedInput ?? event.input,
                      tool_response: settlement.result,
                      error: settlement.result.type === "error" ? String(settlement.result.value) : undefined,
                    })
                    return settlement
                  }),
                ).pipe(
                  Effect.flatMap((settlement) =>
                    publish(
                      LLMEvent.toolResult({
                        id: event.id,
                        name: event.name,
                        result: settlement.result,
                        output: settlement.output,
                      }),
                      settlement.outputPaths ?? [],
                    ),
                  ),
                ),
              )
              // Review sees the settled artifacts, including effects of every ordinary sibling tool.
              if (event.name === "goal_complete") {
                completionTools.push(execute)
                return
              }
              activeTools++
              yield* execute.pipe(
                // A tool ending is activity: the watchdog must not count its runtime as provider silence.
                Effect.ensuring(
                  Clock.currentTimeMillis.pipe(
                    Effect.map((now) => {
                      activeTools--
                      lastEventAt = now
                    }),
                  ),
                ),
                FiberSet.run(toolFibers),
              )
            }).pipe(Effect.ensuring(Effect.sync(() => timing.busy(event, handling, performance.now()))))
          }),
        )
      }).pipe(Effect.ensuring(publishArrived.pipe(Effect.andThen(withPublication(publisher.flush())))))

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(Effect.raceFirst(providerStream, watchdog)).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          // What the provider counted for this request anchors the next projection, and raises a
          // lesson the provider has just shown too low.
          const accepted = reportedTokens
            ? reportedTokens.input + reportedTokens.cache.read + reportedTokens.cache.write
            : 0
          if (accepted > 0) {
            anchors.set(session.id, { counted: accepted, estimate: compaction.sizeOf(request) })
            yield* raiseLimit({ sessionID: session.id, model, request, accepted })
          } else anchors.delete(session.id)
          // The refusal says what the provider's limit is: the next request is sized by it.
          if (isContextOverflowFailure(overflowFailure ?? failure))
            yield* learnLimit({ sessionID: session.id, model, request, failure: overflowFailure ?? failure })
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          ) {
            anchors.delete(session.id)
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep, retry))
          }
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          // A provider that refuses native tool search must not take the turn down with it, nor
          // every later turn: fall back to the client-side tool and replay this step. A reference it
          // could not resolve comes from this Session's history, so the model keeps its support.
          if (
            llmFailure &&
            toolMaterialization?.native !== undefined &&
            !publisher.hasAssistantStarted() &&
            !needsContinuation &&
            NativeToolSearch.isRejection(llmFailure)
          ) {
            if (!NativeToolSearch.isMissingReference(llmFailure)) NativeToolSearch.reject(model)
            yield* Effect.logWarning("Provider refused native tool search; falling back", {
              sessionID: session.id,
              model: model.id,
            })
            return yield* Effect.die(
              new TurnTransitionError({
                _tag: "RetryWithoutNativeSearch",
                step: currentStep,
                retry: { attempt, goalID },
              }),
            )
          }
          const retryReason =
            llmFailure &&
            !(llmFailure.reason._tag === "Transport" && llmFailure.reason.kind === stallKind) &&
            !publisher.hasProviderError() &&
            stream._tag === "Failure" &&
            !Cause.hasInterrupts(stream.cause)
              ? SessionRetry.retryableLLM(llmFailure)
              : undefined
          // An empty failed attempt can replay the same request. Once output is durable, the next
          // request instead sees that output plus a continuation instruction, so completed tools
          // and already streamed text are not repeated.
          const retryable =
            llmFailure &&
            attempt <= SessionRetry.RETRY_MAX_RETRIES &&
            !needsContinuation &&
            completionTools.length === 0 &&
            !publisher.hasAssistantStarted() &&
            retryReason
              ? retryReason
              : undefined
          const reconnect =
            llmFailure &&
            attempt <= SessionRetry.CONNECTION_CONTINUATION_MAX_RETRIES &&
            publisher.hasAssistantStarted() &&
            SessionRetry.connectionInterruptedLLM(llmFailure) &&
            retryReason
              ? retryReason
              : undefined
          if (llmFailure && !publisher.hasProviderError() && !retryable) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(
            awaitToolFibers(toolFibers).pipe(
              Effect.andThen(() =>
                stream._tag === "Success" && !publisher.hasProviderError()
                  ? Effect.forEach(completionTools, (execute) => execute, { discard: true })
                  : Effect.void,
              ),
            ),
          ).pipe(Effect.exit)
          const stepSettlement = publisher.stepSettlement()
          const tokens =
            (reportedTokens?.input ?? 0) +
            (reportedTokens?.output ?? 0) +
            (reportedTokens?.reasoning ?? 0) +
            (reportedTokens?.cache.read ?? 0) +
            (reportedTokens?.cache.write ?? 0)
          // Charge the known provider usage once, before interruption or completion can leave this turn.
          if (goalID) yield* goals.recordUsage(sessionID, goalID, tokens)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools(ToolInterrupted.RESULT))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools(ToolInterrupted.RESULT))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
                // Taken after tool runs and snapshots, but the window ends at the last token.
                timing: timing.snapshot({
                  output: stepSettlement.tokens.output,
                  reasoning: stepSettlement.tokens.reasoning,
                }),
              }),
            )
          }
          if (publisher.hasProviderError()) yield* withPublication(publisher.failUnsettledTools(ToolInterrupted.RESULT))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") {
            const retry = retryable ?? reconnect
            if (llmFailure && retry) {
              if (reconnect)
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: session.id,
                  messageID: SessionMessage.ID.create(),
                  timestamp: yield* DateTime.now,
                  text: SessionRetry.CONNECTION_CONTINUATION_PROMPT,
                })
              return yield* Effect.die(
                new TurnTransitionError({
                  _tag: "RetryProvider",
                  step: currentStep,
                  retry: { attempt, goalID },
                  failure: llmFailure,
                  message: retry.message,
                }),
              )
            }
            if (goalID)
              yield* goals
                .settle(sessionID, { goalID, tokens: 0, failed: true, interrupted: Cause.hasInterrupts(stream.cause) })
                .pipe(Effect.orDie)
            return yield* Effect.failCause(stream.cause)
          }
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          yield* SessionTodo.reviewOrKeep(todos, sessionID)
          if (settled._tag === "Success" && !publisher.hasProviderError()) {
            const failure = yield* restore(completion.settle(sessionID)).pipe(
              Effect.match({
                onSuccess: () => undefined,
                onFailure: (error) => error.message,
              }),
            )
            if (failure) {
              needsContinuation = true
              yield* events.publish(SessionEvent.Synthetic, {
                sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                text: `Goal verification could not be accepted: ${failure}`,
              })
            }
          }
          // A loop the correction did not break ends the turn, and pauses an active goal with the reason.
          if (loopStop) yield* pauseGoal(sessionID, loopStop)
          return {
            goalStopped: false,
            goalID,
            failed: publisher.hasProviderError(),
            tokens: 0,
            needsContinuation: !publisher.hasProviderError() && needsContinuation && loopStop === undefined,
            todoEligible:
              !publisher.hasProviderError() &&
              stepSettlement?.finish === "stop" &&
              !isLastStep &&
              (toolMaterialization?.definitions.some((tool) => tool.name === "todowrite") ?? false),
            step: currentStep,
          }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      retry?: Retry,
      withoutNative?: boolean,
    ) => Effect.Effect<
      {
        readonly needsContinuation: boolean
        readonly todoEligible: boolean
        readonly step: number
        readonly goalStopped: boolean
        readonly goalID: string | undefined
        readonly failed: boolean
        readonly tokens: number
      },
      RunError
    >

    const nextRetry = (retry: Retry): Retry => ({ ...retry, attempt: retry.attempt + 1 })

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(
      function* (sessionID, promotion, step, retry, withoutNative) {
        return yield* runTurnAttempt(sessionID, promotion, step, undefined, retry, withoutNative).pipe(
          Effect.catchDefect(
            Effect.fnUntraced(function* (defect) {
              if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
              if (defect.transition._tag === "RetryWithoutNativeSearch")
                return yield* runAfterOverflowCompaction(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  defect.transition.retry,
                  true,
                )
              if (defect.transition._tag === "RetryProvider") {
                yield* waitToRetry(sessionID, defect.transition)
                return yield* runAfterOverflowCompaction(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  nextRetry(defect.transition.retry),
                )
              }
              // A compaction, of either kind, is followed by another attempt without overflow
              // recovery; the compaction guard bounds how many run for one request, after which
              // the preflight sends or refuses and the attempt ends the turn cleanly.
              yield* Effect.yieldNow
              return yield* runAfterOverflowCompaction(
                sessionID,
                undefined,
                defect.transition.step,
                defect.transition.retry,
              )
            }),
          ),
        )
      },
    )

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, retry, withoutNative) {
      return yield* runTurnAttempt(
        sessionID,
        promotion,
        step,
        compaction.compactAfterOverflow,
        retry,
        withoutNative,
      ).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "RetryWithoutNativeSearch")
              return yield* runTurn(sessionID, undefined, defect.transition.step, defect.transition.retry, true)
            if (defect.transition._tag === "RetryProvider") {
              yield* waitToRetry(sessionID, defect.transition)
              return yield* runTurn(sessionID, undefined, defect.transition.step, nextRetry(defect.transition.retry))
            }
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(
                sessionID,
                undefined,
                defect.transition.step,
                defect.transition.retry,
              )
            return yield* runTurn(sessionID, undefined, defect.transition.step, defect.transition.retry)
          }),
        ),
      )
    })

    const continueAfterStop: (sessionID: SessionSchema.ID, attempts: number) => Effect.Effect<void, RunError> =
      Effect.fn("SessionRunner.continueAfterStop")(function* (sessionID, attempts) {
        const decision = yield* hooks.run({ event: "Stop", session_id: sessionID, matcher: "stop" })
        if (decision.continue && decision.decision !== "deny") return
        if (attempts >= 7) {
          yield* Effect.logWarning("Stop hook continuation limit reached", { sessionID, attempts: attempts + 1 })
          return
        }
        yield* runTurn(sessionID, undefined, 1)
        return yield* continueAfterStop(sessionID, attempts + 1)
      })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      promptAttempts.set(input.sessionID, new Map())
      const runGoal = yield* goals.get(input.sessionID).pipe(Effect.orDie)
      yield* completion.discard(input.sessionID)
      yield* compaction.beginTurn(input.sessionID)
      return yield* Effect.gen(function* () {
        const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
        if (!input.force && !hasSteer && !hasQueue) return
        yield* failInterruptedTools(input.sessionID)
        let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
        let shouldRun = input.force || hasSteer || hasQueue
        while (shouldRun) {
          let needsContinuation = true
          let step = 1
          let todoContinuations = 0
          let responseRepairs = 0
          while (needsContinuation) {
            const result = yield* runTurn(input.sessionID, promotion, step)
            if (result.goalStopped) return
            if (result.goalID) {
              const continuing = yield* goals
                .settle(input.sessionID, { goalID: result.goalID, tokens: result.tokens, failed: result.failed })
                .pipe(Effect.orDie)
              if (!continuing) return
            }
            needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            if (!needsContinuation && result.todoEligible) {
              const reminder = SessionTodo.reminder(yield* SessionTodo.reviewOrKeep(todos, input.sessionID))
              if (reminder && todoContinuations < 7) {
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: input.sessionID,
                  messageID: SessionMessage.ID.create(),
                  timestamp: yield* DateTime.now,
                  text: reminder,
                })
                todoContinuations++
                needsContinuation = true
              } else if (reminder) {
                const goal = yield* goals.get(input.sessionID).pipe(Effect.orDie)
                if (goal?.status === "active")
                  yield* goals
                    .save(goal, { ...goal, status: "paused", reason: SessionTodo.limitReason })
                    .pipe(Effect.orDie)
                yield* db
                  .insert(SessionGuardTripTable)
                  .values({
                    id: crypto.randomUUID(),
                    session_id: input.sessionID,
                    guard: "steps",
                    action: "stop",
                    subject: "task-continuation",
                    detail: SessionTodo.limitReason,
                  })
                  .run()
                  .pipe(Effect.orDie)
                yield* events.publish(SessionEvent.Guard.Tripped, {
                  sessionID: input.sessionID,
                  timestamp: yield* DateTime.now,
                  guard: "steps",
                  action: "stop",
                  subject: "task-continuation",
                  detail: SessionTodo.limitReason,
                })
                yield* Effect.logWarning("Todo continuation limit reached", {
                  sessionID: input.sessionID,
                  attempts: todoContinuations,
                })
              }
            }
            // Waiting on an external observation is a scheduler boundary: neither the todo nudger
            // nor a goal continuation should spend provider calls while a monitor watches for a
            // condition. Every running poll parks (`PARK_LIMIT_MS` bounds only one-shot command
            // monitors, which this runtime cannot start), and the monitor's own queued result starts
            // the next turn.
            //
            // A person waiting outranks the monitor: one queued prompt is promoted and answered
            // first, so a user message never starves behind an observation.
            if (!needsContinuation && (yield* monitors.list(input.sessionID)).some(MonitorSchema.parks)) {
              if (!(yield* SessionInput.promoteNextQueued(db, events, input.sessionID))) return
              needsContinuation = true
            }
            if (!needsContinuation) {
              const goal = yield* goals.get(input.sessionID).pipe(Effect.orDie)
              const blocked = SessionTodo.blocker(yield* todos.get(input.sessionID))
              if (goal?.status === "active" && blocked)
                yield* goals.save(goal, { ...goal, status: "blocked", reason: blocked }).pipe(Effect.orDie)
              if (goal?.status === "active" && !blocked) {
                const documents = yield* designs.list(input.sessionID).pipe(Effect.orDie)
                const jobs = yield* Effect.forEach(documents, (document) =>
                  renderer.jobs(document.id).pipe(Effect.orDie),
                )
                if (jobs.flat().some((job) => job.status === "running" || job.status === "queued")) {
                  yield* goals.settle(input.sessionID, { goalID: goal.id, tokens: 0, waiting: true }).pipe(Effect.orDie)
                  return
                }
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: input.sessionID,
                  messageID: SessionMessage.ID.create(),
                  timestamp: yield* DateTime.now,
                  text: `Goal is still active: ${goal.objective}. ${goal.reason}. Continue within scope, verify completion with goal_complete, or report a concrete blocker with goal_status.`,
                })
                needsContinuation = true
              }
            }
            if (!needsContinuation) {
              const evaluation = yield* reviewResponse(input.sessionID, responseRepairs).pipe(
                Effect.catch((error) =>
                  reportIntelligenceFailure(input.sessionID, "response_quality", String(error)).pipe(
                    Effect.as(undefined),
                  ),
                ),
              )
              if (
                evaluation &&
                evaluation.decision !== "accepted" &&
                evaluation.decision !== "unavailable" &&
                responseRepairs < 2
              ) {
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: input.sessionID,
                  messageID: SessionMessage.ID.create(),
                  timestamp: yield* DateTime.now,
                  text: `${RESPONSE_REPAIR}\nCorrect the final response for these evaluation issues: ${evaluation.issues.join(", ")}.`,
                })
                responseRepairs++
                needsContinuation = true
              } else if (evaluation && evaluation.decision !== "accepted") {
                const detail = `System One response review ${evaluation.decision} (${evaluation.id}). Unresolved issues: ${evaluation.issues.join(", ") || "evaluation could not verify completion"}. Completion has not been verified; preserve outstanding work and report these limits.`
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: input.sessionID,
                  messageID: SessionMessage.ID.create(),
                  timestamp: yield* DateTime.now,
                  text: detail,
                })
                yield* recordGuard({
                  sessionID: input.sessionID,
                  guard: "intelligence",
                  action: "warn",
                  subject: "response_quality",
                  detail,
                })
              }
            }
          }
          shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
          promotion = shouldRun ? "queue" : undefined
        }
        yield* continueAfterStop(input.sessionID, 0)
      }).pipe(
        Effect.ensuring(Effect.sync(() => promptAttempts.delete(input.sessionID))),
        Effect.ensuring(completion.discard(input.sessionID)),
        Effect.ensuring(compaction.discard(input.sessionID)),
        Effect.ensuring(setIdle(input.sessionID)),
        Effect.onError((cause) =>
          runGoal
            ? goals
                .settle(input.sessionID, {
                  goalID: runGoal.id,
                  tokens: 0,
                  failed: true,
                  interrupted: Cause.hasInterrupts(cause),
                })
                .pipe(Effect.ignore)
            : Effect.void,
        ),
      )
    })

    return Service.of({
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    Intelligence.node,
    Semantic.node,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    DesignStore.node,
    DesignRenderer.node,
    SkillGuidance.node,
    SkillV2.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
    HookV2.node,
    SessionTodo.node,
    SessionGoal.node,
    SessionGoalCompletion.node,
    SessionPlan.node,
    Monitor.node,
    ModelLimit.node,
  ],
})
