export * as SessionRunnerLLM from "./llm.js"

import path from "node:path"
import { AIError, Message, ProviderErrorEvent, SystemPart } from "@opencode/ai"
import { Monitor } from "@opencode/schema/monitor"
import { Global } from "@opencode/util/global"
import { and, desc, eq, sql } from "drizzle-orm"
import { Cause, Clock, Effect, Exit, Fiber, FiberMap, Layer, Option, Schema } from "effect"
import { Database } from "../../database/database.js"
import { DesignIdentify } from "../../design/identify.js"
import { DesignProposal } from "../../design/proposal.js"
import { DesignStore } from "../../design/store.js"
import { Location } from "../../location.js"
import { Bus } from "../../bus.js"
import { ModelLimit } from "../../model-limit.js"
import { contextOverflowNumbers } from "../../model-limit-numbers.js"
import { modelLimitNode } from "#model-limit-node"
import { LocationLifecycle } from "../../location-lifecycle.js"
import { Instructions } from "../../instructions/index.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionEvent } from "../event.js"
import { SessionInbox } from "../inbox.js"
import { SessionHistory } from "../history.js"
import { SessionProviderContext } from "../provider-context.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionMessageTable } from "../sql.js"
import { SessionTitle } from "../title.js"
import { SessionGoal } from "../goal.js"
import { SessionBudget } from "../budget.js"
import { SessionGuardLog } from "../guard-log.js"
import { SessionPlan } from "../plan.js"
import { SessionGoalCompletion } from "../goal-completion.js"
import { SessionTaskFacts } from "../task-facts.js"
import { SessionTodo } from "../todo.js"
import { SessionTodoStore } from "../todo-store.js"
import { HookRuntime } from "../../hook.js"
import { MonitorRuntime } from "../../monitor.js"
import { ProviderRouter } from "../../provider-router.js"
import { toSessionError } from "../to-session-error.js"
import { DrainResult, Service, type Interface } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { ToolOutput } from "../../tool-output.js"
import { Plugin } from "../../plugin.js"
import { Permission } from "../../permission.js"
import { Config } from "../../config.js"
import { LoopGuard } from "../loop-guard.js"
import { SessionStall } from "../stall.js"
import { SessionStopLoss } from "../stop-loss.js"
import { Intelligence } from "../../intelligence.js"
import { CodeModeCatalog } from "../../codemode/catalog.js"
import { IntelligenceClassification } from "../../intelligence/classification.js"
import { IntelligenceSatisfaction } from "../../intelligence/satisfaction.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { Tool } from "../../tool.js"
import { IntelligenceArtifacts } from "../../intelligence/artifacts.js"
import { IntelligenceLearning } from "../../intelligence/learning.js"
import { SessionContextCuration } from "../context-curation.js"
import { IntelligenceVerification } from "../../intelligence/verification.js"
import { IntelligenceCodeRepair } from "../../intelligence/code-repair.js"
import { RelativePath } from "../../schema.js"
import { IntelligenceResponse } from "../../intelligence/response.js"
import { Job } from "../../job.js"
import { Skill } from "../../skill.js"
import { Vault } from "../../vault/vault.js"
import { VaultRestricted } from "../../vault/restricted.js"
import { MAX_STEPS_PROMPT, stepLimit } from "./max-steps.js"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."
/** Messages read back when judging a goal or reviewing a final response. */
const RECENT = 60

/** Goal continuation memory for one drain, reset by a new goal or a new user message. */
interface GoalLoop {
  readonly goalID?: string
  readonly userID?: string
  readonly stalled: number
  readonly unavailable: number
}

/** Final response review memory for one drain, reset by a new user message. */
interface ResponseReview {
  readonly userID?: string
  readonly attempts: number
  readonly issues: ReadonlyArray<string>
  /** The response the last repair revised. */
  readonly text?: string
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const lifecycle = yield* LocationLifecycle.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const limits = yield* ModelLimit.Service
    const plugins = yield* Plugin.Service
    const config = yield* Config.Service
    const title = yield* SessionTitle.Service
    const todos = yield* SessionTodoStore.Service
    const goals = yield* SessionGoal.Service
    const budgets = yield* SessionBudget.Service
    const guards = yield* SessionGuardLog.Service
    const artifacts = yield* IntelligenceArtifacts.Service
    const intelligence = yield* Intelligence.Service
    const facts = yield* SessionTaskFacts.Service
    const plans = yield* SessionPlan.Service
    const monitors = yield* MonitorRuntime.Service
    const inbox = yield* SessionInbox.Service
    const jobs = yield* Job.Service
    const skills = yield* Skill.Service
    const designs = yield* DesignStore.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const vault = yield* Vault.Service
    const registry = yield* Tool.Service
    const snapshot = yield* Snapshot.Service
    const steps = yield* SessionStep.make
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()
    // Prompt classifications outlive the Step that started them, so a slow one still lands in history.
    const classifications = yield* FiberMap.make<SessionMessage.ID>()
    const observedClassifications = new Set<SessionMessage.ID>()
    // Design-system warm-ups run beside the Step; `warmed` holds the user message each Session last warmed for.
    const warmups = yield* FiberMap.make<SessionSchema.ID, void, never>()
    const warmed = new Map<SessionSchema.ID, SessionMessage.ID>()
    // Whether System One takes part; an unreadable configuration reads as single reasoning, never a failed prompt.
    const dual = (sessionID: string) =>
      intelligence.read(sessionID).pipe(
        Effect.map((settings) => settings.enabled && IntelligenceEvaluation.mode(settings) === "dual"),
        Effect.orElseSucceed(() => false),
      )

    const satisfaction = Effect.fn("SessionRunner.satisfaction")(function* (sessionID: SessionSchema.ID) {
      if (!(yield* dual(sessionID))) return ""
      const evaluations = yield* intelligence.history(sessionID, { limit: 100 })
      const trips = yield* guards.recent({
        sessionID,
        since: Math.min(Date.now(), ...evaluations.map((evaluation) => evaluation.created)),
        limit: 200,
      })
      return IntelligenceSatisfaction.context(evaluations, trips)
    })

    // Verification admission is a durable fact, independent of the model window or recent-message limit.
    const verificationState = Effect.fn("SessionRunner.verificationState")(function* (sessionID: SessionSchema.ID) {
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 }))[0]
      if (!user) return undefined
      const markers = yield* store.messages({
        sessionID,
        type: "synthetic",
        order: "asc",
        cursor: { id: user.id, direction: "next" },
      })
      const marker = markers.findLast(
        (message) => message.type === "synthetic" && message.metadata?.[IntelligenceVerification.KEY] !== undefined,
      )
      if (!marker) return undefined
      const after = yield* store.messages({
        sessionID,
        type: "assistant",
        order: "asc",
        cursor: { id: marker.id, direction: "next" },
        limit: 1,
      })
      return IntelligenceVerification.state([user, marker, ...after])
    })

    const codeRepairState = Effect.fn("SessionRunner.codeRepairState")(function* (sessionID: SessionSchema.ID) {
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 }))[0]
      if (!user) return undefined
      const markers = yield* store.messages({
        sessionID,
        type: "synthetic",
        order: "asc",
        cursor: { id: user.id, direction: "next" },
      })
      const marker = markers.findLast(
        (message) => message.type === "synthetic" && message.metadata?.[IntelligenceCodeRepair.KEY] !== undefined,
      )
      if (!marker) return undefined
      const after = yield* store.messages({
        sessionID,
        type: "assistant",
        order: "asc",
        cursor: { id: marker.id, direction: "next" },
        limit: IntelligenceCodeRepair.MAX_STEPS,
      })
      return IntelligenceCodeRepair.state([user, marker, ...after])
    })

    const drain = Effect.fn("SessionRunner.drain")(function* (input: Parameters<Interface["drain"]>[0]) {
      const sessionID = input.sessionID
      let force = input.force
      let continuing = input.continuation !== undefined
      let step = input.continuation?.step ?? 1
      let entering = true
      let todoContinuations = 0
      let guardStopped = false
      let stopLoss = SessionStopLoss.FRESH
      let goalLoop: GoalLoop = { stalled: 0, unavailable: 0 }
      let review: ResponseReview = { attempts: 0, issues: [] }
      const promotable = input.promotable ?? "input"
      if (!force && !continuing) {
        const pending = yield* SessionInbox.nextPromotable(db, sessionID, "input")
        if (!pending) return DrainResult.Complete()
        const control = pending.type === "compaction" || pending.type === "move"
        if (promotable === "steer" && pending.delivery === "queue" && !control) return DrainResult.Complete()
      }
      yield* plugins.awaitActivation
      yield* settleStaleCompactions(sessionID)
      yield* settleStaleToolCalls(sessionID)

      const advanceToStep = Effect.fn("SessionRunner.advanceToStep")(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              if (lifecycle.isClosed()) {
                yield* restore(modelTransport.close(sessionID))
                return DrainResult.Reloaded({ force, continuation: continuing ? { step } : undefined })
              }
              // Location entry and idle boundaries allow queued controls, not necessarily queued prompts.
              const pending = yield* SessionInbox.serialized(
                sessionID,
                Effect.gen(function* () {
                  const next = yield* SessionInbox.nextPromotable(
                    db,
                    sessionID,
                    entering || !continuing ? "input" : "steer",
                  )
                  if (next?.type === "compaction")
                    yield* bus.publishAll([
                      [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                      [SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "", inputID: next.id }],
                    ])
                  if (next?.type === "move")
                    yield* restore(
                      Effect.gen(function* () {
                        yield* modelTransport.close(sessionID)
                        yield* bus.publishAll([
                          [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                          [SessionEvent.Moved, { sessionID, ...next.payload }],
                        ])
                      }),
                    )
                  return next
                }),
              )
              if (!continuing && pending?.delivery !== "steer") {
                entering = true
                step = 1
              }
              if (pending?.type === "move")
                return DrainResult.Moved({ continuation: continuing ? { step } : undefined })
              if (pending?.type === "compaction") {
                const compacted = yield* restore(
                  Effect.gen(function* () {
                    const selected = yield* context.select(sessionID)
                    const model = yield* context.resolveModel(selected.session)
                    // Preview updates without admitting them after the already-delivered compaction marker.
                    const history = yield* SessionHistory.preview(
                      db,
                      sessionID,
                      selected.instructions,
                      SessionProviderContext.provenance(model) ?? "local",
                    )
                    return yield* compaction.compact({
                      reason: "manual",
                      inputID: pending.id,
                      focus: pending.payload.focus,
                      context: {
                        session: selected.session,
                        agent: selected.agent,
                        tools: selected.tools,
                        model,
                        initial: history.initial,
                        messages: history.messages,
                      },
                    })
                  }).pipe(
                    Effect.catch((error) =>
                      bus.publish(SessionEvent.Compaction.Failed, {
                        sessionID,
                        reason: "manual",
                        inputID: pending.id,
                        error: toSessionError(error),
                      }),
                    ),
                  ),
                ).pipe(Effect.exit)
                if (Exit.isFailure(compacted)) {
                  yield* bus.publish(SessionEvent.Compaction.Failed, {
                    sessionID,
                    reason: "manual",
                    error: Cause.hasInterruptsOnly(compacted.cause)
                      ? { type: "aborted", message: "Compaction cancelled" }
                      : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
                    inputID: pending.id,
                  })
                  return yield* Effect.failCause(compacted.cause)
                }
                force = false
                continue
              }
              if (!force && !continuing && (!pending || (pending.delivery === "queue" && promotable === "steer")))
                return DrainResult.Complete()
              const ready = yield* restore(
                Effect.gen(function* () {
                  const selected = yield* prepareContext(sessionID)
                  const promoted = yield* SessionInbox.promote(
                    db,
                    bus,
                    sessionID,
                    entering && !continuing ? promotable : "steer",
                  )
                  // A control admitted during context preparation owns this boundary.
                  if (promoted === undefined) return undefined
                  if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
                    yield* FiberMap.run(titles, sessionID, title.generate(sessionID), {
                      onlyIfMissing: true,
                    })
                  if (promoted > 0) {
                    step = 1
                    todoContinuations = 0
                    stopLoss = SessionStopLoss.FRESH
                    guardStopped = false
                  }
                  return { _tag: "Ready" as const, context: yield* context.load(selected) }
                }),
              )
              if (ready) return ready
            }
          }),
        ),
      )

      while (true) {
        const next = yield* advanceToStep()
        if (next._tag !== "Ready") return next
        const configuredBudget = SessionBudget.configured(Config.latest(yield* config.entries(), "session")?.budget)
        if (!(yield* budgets.admit(sessionID, configuredBudget))) return DrainResult.Complete()
        // Classification runs beside S2; only already persisted guidance can enter this Step.
        const verification = yield* verificationState(sessionID)
        if (verification && !verification.pending) return DrainResult.Complete()
        const codeRepair = yield* codeRepairState(sessionID)
        if (codeRepair && !codeRepair.pending) return DrainResult.Complete()
        const classification = verification?.pending || codeRepair?.pending ? undefined : yield* classify(next.context)
        // What System One made of the request steers a RedRouter's requests for this Step; without a
        // classification the previous request's guidance is forgotten, never carried over.
        ProviderRouter.guide(sessionID, IntelligenceClassification.routerGuidance(classification))
        yield* warmDesignSystem(next.context, IntelligenceClassification.workRoute(classification))
        const goalID = yield* goals.beginStep(sessionID)
        if (goalID === false) return DrainResult.Complete()
        const advice = [
          IntelligenceClassification.steer(classification),
          yield* satisfaction(sessionID).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Session satisfaction unavailable", { sessionID, cause: Cause.pretty(cause) }).pipe(
                Effect.as(""),
              ),
            ),
          ),
        ]
          .filter(Boolean)
          .join("\n\n")
        const result = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const result = yield* restore(
              runStep(next.context, step, goalID, advice, () => {
                guardStopped = true
              }),
            ).pipe(Effect.exit)
            if (goalID)
              yield* goals
                .settle(sessionID, {
                  goalID,
                  tokens: 0,
                  interrupted: Exit.isFailure(result) && Cause.hasInterrupts(result.cause),
                  failed: Exit.isFailure(result) && !Cause.hasInterrupts(result.cause),
                  waiting: Exit.isSuccess(result) && (yield* monitors.list(sessionID)).some(Monitor.parks),
                })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Goal step settlement failed", { sessionID, cause: Cause.pretty(cause) }),
                  ),
                )
            return result
          }),
        )
        if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
        continuing = verification?.pending
          ? false
          : codeRepair?.pending
            ? codeRepair.remaining > 1 && result.value
            : result.value && !(yield* monitors.list(sessionID)).some(Monitor.parks)
        if (
          continuing &&
          !verification?.pending &&
          !guardStopped &&
          next.context.agent.id !== "question" &&
          !(yield* SessionInbox.nextPromotable(db, sessionID, "steer")) &&
          !(yield* monitors.list(sessionID)).some(Monitor.parks)
        ) {
          const checked = yield* checkStopLoss(next.context, step, stopLoss)
          stopLoss = checked.memory
          if (checked.ended) {
            continuing = false
            guardStopped = true
          }
        }
        if (
          !continuing &&
          !verification?.pending &&
          !codeRepair?.pending &&
          !guardStopped &&
          // A Design reply can hand a preview to the reviewer while approval tasks remain pending.
          !["question", "design"].includes(next.context.agent.id) &&
          !(yield* SessionInbox.nextPromotable(db, sessionID, "steer")) &&
          !(yield* monitors.list(sessionID)).some(Monitor.parks) &&
          step <
            (stepLimit(
              next.context.agent.info.steps,
              Config.latestExperimental(yield* config.entries(), "turn_steps"),
            ) ?? Infinity)
        ) {
          const reminder = SessionTodo.reminder(
            SessionTodo.forAgent(
              yield* Effect.firstSuccessOf([todos.review(sessionID), todos.get(sessionID)]),
              next.context.agent.id,
            ),
          )
          if (reminder && todoContinuations < 7) {
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: reminder })
            todoContinuations++
            continuing = true
          }
          if (reminder && todoContinuations >= 7 && !continuing) {
            const goal = yield* goals.get(sessionID).pipe(Effect.orDie)
            if (goal?.status === "active")
              yield* goals.save(goal, { ...goal, status: "paused", reason: SessionTodo.limitReason }).pipe(Effect.orDie)
            yield* Effect.logWarning("Task continuation limit reached", { sessionID, attempts: todoContinuations })
          }
        }
        // At the idle boundary an active goal continues through the inbox; otherwise the final response is reviewed.
        if (
          !continuing &&
          !guardStopped &&
          next.context.agent.id !== "question" &&
          !(yield* SessionInbox.has(db, sessionID, "input")) &&
          !(yield* monitors.list(sessionID)).some(Monitor.parks)
        ) {
          const started = yield* startReview(next.context, review)
          const pursued =
            verification?.pending || codeRepair?.pending
              ? { memory: goalLoop, continued: false }
              : yield* pursueGoal(next.context, goalLoop).pipe(
                  // A goal changed by the user while it was judged is theirs to resume.
                  Effect.catchTag("SessionGoal.Error", () => Effect.succeed({ memory: goalLoop, continued: false })),
                  Effect.onError(() => (started ? Fiber.interrupt(started) : Effect.void)),
                )
          goalLoop = pursued.memory
          if (pursued.continued && started) yield* Fiber.interrupt(started)
          if (!pursued.continued) {
            const reviewed = yield* reviewResponse(next.context, review, started)
            review = reviewed.memory
            continuing = reviewed.repair
          }
        }
        step++
        force = false
        entering = false
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      const base = yield* context.select(sessionID)
      const selected = {
        ...base,
        instructions: Instructions.combine([base.instructions, compaction.wrapUp(sessionID)]),
      }
      // A blocked initial instruction baseline must leave admitted input pending.
      yield* InstructionState.prepare(db, bus, selected.instructions, sessionID)
      return selected
    })

    const checkStopLoss = Effect.fn("SessionRunner.checkStopLoss")(function* (
      loaded: SessionContext.Loaded,
      step: number,
      memory: SessionStopLoss.Memory,
    ) {
      const sessionID = loaded.session.id
      const entries = yield* config.entries()
      const bounds = SessionStopLoss.limits(
        Config.latestExperimental(entries, "stop_loss"),
        LoopGuard.limits(Config.latestExperimental(entries, "loop_guard")),
      )
      if (!bounds) return { memory, ended: false }
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 })).at(0)
      if (!user || user.type !== "user") return { memory, ended: false }
      const messages = yield* store.messages({
        sessionID,
        order: "asc",
        cursor: { id: user.id, direction: "next" },
      })
      const turn = SessionStopLoss.projected([user, ...messages])
      const trajectory = SessionStopLoss.observe(turn.steps, {
        now: yield* Clock.currentTimeMillis,
        started: turn.started,
      })
      const settings = yield* intelligence.read(sessionID)
      const asked = settings.enabled && IntelligenceEvaluation.mode(settings) === "dual"
      const remembered = memory === SessionStopLoss.FRESH ? (SessionStopLoss.recover(messages) ?? memory) : memory
      const current = SessionStopLoss.current(remembered, step, trajectory.idle)
      const helped = SessionStopLoss.outcome(remembered, current, step, trajectory)
      if (helped) yield* guards.record({ sessionID, guard: "stop_loss", action: "warn", ...helped })
      const checkpoint = SessionStopLoss.due({
        step,
        memory: current,
        limits: bounds,
        signals: SessionStopLoss.signals(trajectory, bounds),
        interval: asked,
      })
      if (checkpoint.type === "none") return { memory: current, ended: false }
      const subagent = loaded.session.parentID !== undefined
      const evaluation = asked
        ? yield* intelligence
            .evaluate(
              SessionStopLoss.evaluation({
                sessionID,
                request: turn.request,
                steps: turn.steps,
                trajectory,
                checkpoint,
                subagent,
                directory: loaded.session.location.directory,
                limits: bounds,
              }),
            )
            .pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const verdict = SessionStopLoss.decide({
        trajectory,
        limits: bounds,
        memory: current,
        asked,
        evaluation,
        subagent,
      })
      const next = SessionStopLoss.remember(current, step, verdict)
      if (verdict.action === "continue") {
        const ignored = SessionStopLoss.dismissed(checkpoint, trajectory, verdict)
        if (ignored) yield* guards.record({ sessionID, guard: "stop_loss", action: "warn", ...ignored })
        return { memory: next, ended: false }
      }
      // New input admitted while S1 evaluated takes the next boundary instead of a stale intervention.
      if (yield* SessionInbox.nextPromotable(db, sessionID, "steer")) return { memory, ended: false }
      yield* guards.record({
        sessionID,
        guard: "stop_loss",
        action: verdict.action === "steer" ? "correct" : "stop",
        subject: checkpoint.type === "signal" ? checkpoint.signals.join(",") : "interval",
        detail: SessionStopLoss.detail(trajectory, verdict),
      })
      const text =
        verdict.action === "steer"
          ? SessionStopLoss.steer(trajectory, verdict)
          : SessionStopLoss.final(trajectory, verdict, { subagent })
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text,
        ...(verdict.action === "steer" ? {} : { description: text }),
        metadata: {
          [SessionStopLoss.METADATA_KEY]: {
            ...SessionStopLoss.notice(trajectory, verdict, { subagent }),
            memory: next,
          },
        },
      })
      if (verdict.action === "steer") return { memory: next, ended: false }
      const goal = yield* goals.get(sessionID)
      if (goal?.status === "active")
        yield* goals
          .save(goal, {
            ...goal,
            status: "paused",
            reason: `${SessionStopLoss.PAUSE}${SessionStopLoss.reason(trajectory, verdict)}`,
          })
          .pipe(Effect.orDie)
      return { memory: next, ended: true }
    })

    /**
     * Classifies the latest user request with System One once, from a bounded view of the session.
     * Advisory only: sources and inference run in the background. Persisted guidance enters later
     * Steps for the same user request, without waking execution or resetting the Step allowance.
     */
    const classify = Effect.fn("SessionRunner.classify")(function* (loaded: SessionContext.Loaded) {
      const sessionID = loaded.session.id
      const index = loaded.messages.findLastIndex((message) => message.type === "user")
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 }))[0]
      const settings = yield* intelligence.read(sessionID)
      const mode = IntelligenceEvaluation.mode(settings)
      if (user?.type !== "user" || !settings.enabled || mode === "single") return undefined
      if (mode === "observe" && observedClassifications.has(user.id)) return undefined
      const stored = (yield* intelligence
        .history(sessionID, { operation: "prompt_classification", subjectID: user.id, limit: 1 })
        .pipe(Effect.orElseSucceed(() => [])))[0]
      if (stored && stored.mode === mode) return mode === "observe" ? undefined : stored
      // A classification still running from an earlier Step is not awaited again.
      if (yield* FiberMap.has(classifications, user.id)) return undefined
      const preceding = index < 0 ? loaded.messages : loaded.messages.slice(0, index)
      yield* FiberMap.run(
        classifications,
        user.id,
        Effect.gen(function* () {
          const request = IntelligenceClassification.evaluation({
            sessionID,
            scrub: yield* vault.scrubber(loaded.session.projectID),
            request: { id: user.id, text: user.text, files: user.files },
            history: preceding
              .slice(-IntelligenceClassification.HISTORY)
              .flatMap(IntelligenceClassification.historyEntry),
            omitted: Math.max(0, preceding.length - IntelligenceClassification.HISTORY),
            namespaces:
              loaded.tools.codeModeCatalog &&
              Config.latestExperimental(yield* config.entries(), "reasoning_tool_selection") === true
                ? CodeModeCatalog.summarize(loaded.tools.codeModeCatalog, { budget: 0 }).namespaces.map(
                    (namespace) => ({
                      name: namespace.name,
                      description: namespace.description ?? `${namespace.name}: ${namespace.count} tools`,
                    }),
                  )
                : undefined,
            session: {
              mode: loaded.agent.id,
              goal: SessionGoal.guidance(yield* goals.get(sessionID)),
              plan: SessionPlan.guidance(yield* plans.list(sessionID)),
              continuation: {
                location: loaded.session.location,
                pending: (yield* SessionInbox.list(db, sessionID))
                  .filter((item) => item.type === "user")
                  .map((item) => ({ id: item.id, delivery: item.delivery, text: item.payload.text })),
                tasks: SessionTodo.forAgent(yield* todos.get(sessionID), loaded.agent.id),
                originalRequest: [
                  ...(yield* store.messages({ sessionID, type: "user", order: "asc", limit: 1 })),
                  ...(yield* store.messages({ sessionID, type: "user", limit: 2 })),
                ].map((message) => (message.type === "user" ? { id: message.id, text: message.text } : null)),
                priorDecision: (yield* intelligence.history(sessionID, {
                  operation: "prompt_classification",
                  limit: 2,
                })).find((entry) => entry.subjectID !== user.id && entry.mode !== "observe")?.answers,
              },
            },
            skills: Skill.available(
              yield* skills.list(),
              Permission.forAgent(loaded.agent.info, loaded.session.permissions),
            )
              .flatMap((skill) =>
                skill.description === undefined || skill.autoinvoke === false
                  ? []
                  : [{ name: skill.name, description: skill.description }],
              )
              .toSorted((left, right) => left.name.localeCompare(right.name)),
          })
          // A message S1 reads as carrying restricted content is marked once its answer lands, however late; the marker
          // only keeps it out of derived text and shows a notice, and nothing waits for it.
          yield* intelligence.evaluate(request).pipe(
            Effect.orElseSucceed(() => undefined),
            Effect.tap((evaluation) =>
              IntelligenceClassification.restricted(evaluation) === "flagged"
                ? markRestricted(sessionID, user.id)
                : Effect.void,
            ),
          )
        }).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Prompt classification unavailable", { sessionID, cause })),
        ),
        { onlyIfMissing: true },
      )
      if (mode === "observe") observedClassifications.add(user.id)
      return undefined
    })

    const markRestricted = Effect.fn("SessionRunner.markRestricted")(function* (
      sessionID: SessionSchema.ID,
      messageID: SessionMessage.ID,
    ) {
      const session = yield* store.get(sessionID)
      const metadata = session && VaultRestricted.mark(session.metadata, messageID, "sensitive")
      if (metadata) yield* bus.publish(SessionEvent.MetadataUpdated, { sessionID, metadata })
    })

    /**
     * Starts design-system identification in the background once per user message when the design
     * agent runs or System One routed the request as design, so design_document create finds it cached
     * instead of waiting for System One. Only dual reasoning has anything to warm, and a configured
     * system that is still current needs none. Never blocks the Step; a failure is only logged.
     */
    const warmDesignSystem = Effect.fn("SessionRunner.warmDesignSystem")(function* (
      loaded: SessionContext.Loaded,
      route: string | undefined,
    ) {
      const sessionID = loaded.session.id
      const user = loaded.messages.findLast((message) => message.type === "user")
      if (!user || warmed.get(sessionID) === user.id) return
      if (!DesignIdentify.wanted({ agent: loaded.agent.id, route }) || !(yield* dual(sessionID))) return
      warmed.set(sessionID, user.id)
      yield* FiberMap.run(
        warmups,
        sessionID,
        Effect.gen(function* () {
          const configured = yield* designs.configured(sessionID)
          if (
            configured?.system &&
            !(yield* Effect.promise(() => DesignProposal.stale(location.directory, configured).catch(() => true)))
          )
            return
          yield* DesignIdentify.warm({
            directory: location.directory,
            application: configured?.application,
            state: path.join(global.state, DesignIdentify.STATE),
            mode: "dual",
            sessionID,
            evaluate: (evaluation) => intelligence.evaluate(evaluation),
          })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Design system warm-up failed", { sessionID, cause: Cause.pretty(cause) }),
          ),
        ),
        { onlyIfMissing: true },
      )
    })

    /**
     * Decides what an active goal does when the agent stopped short of completing it: wait for
     * background subagents, block on a confirmed blocker, pause on a spent budget or repeated lack
     * of progress, or continue through a durable synthetic steer. Nothing here completes a goal;
     * only `goal_complete` does, after verifying its evidence.
     */
    const pursueGoal = Effect.fn("SessionRunner.pursueGoal")(function* (
      loaded: SessionContext.Loaded,
      memory: GoalLoop,
    ) {
      const sessionID = loaded.session.id
      const goal = yield* goals.get(sessionID)
      if (loaded.session.parentID || goal?.status !== "active") return { memory, continued: false }
      const recent = (yield* store.messages({ sessionID, order: "desc", limit: RECENT })).toReversed()
      const user = recent.findLast((message) => message.type === "user")
      const current: GoalLoop =
        memory.goalID === goal.id && memory.userID === user?.id
          ? memory
          : { goalID: goal.id, userID: user?.id, stalled: 0, unavailable: 0 }
      const waiting = (yield* jobs.pendingBackground).some(
        (job) =>
          job.status === "running" && job.recovery.kind === "subagent" && job.recovery.parentSessionID === sessionID,
      )
      if (waiting) {
        yield* goals.save(goal, { ...goal, status: "waiting", reason: SessionGoal.WAITING })
        return { memory: current, continued: false }
      }
      const blocker = SessionTodo.blocker(SessionTodo.forAgent(yield* todos.get(sessionID), loaded.agent.id))
      if (blocker) {
        yield* goals.save(goal, { ...goal, status: "blocked", reason: blocker })
        return { memory: current, continued: false }
      }
      if (yield* goals.exhausted(goal)) return { memory: current, continued: false }
      // The work since the latest user message or goal continuation is what this judgement covers.
      const exchange = recent.slice(
        recent.findLastIndex(
          (message) =>
            message.type === "user" ||
            (message.type === "synthetic" && message.metadata?.[SessionGoal.CONTINUATION_KEY] !== undefined),
        ) + 1,
      )
      const parts = exchange.flatMap((message) => (message.type === "assistant" ? SessionStopLoss.parts(message) : []))
      const response = exchange.findLast((message) => message.type === "assistant")
      const text = response?.type === "assistant" ? responseText(response) : ""
      const judged =
        response && text && (yield* dual(sessionID))
          ? SessionGoal.verdict(
              yield* intelligence
                .evaluate(
                  SessionGoal.judgement({
                    goal,
                    response: { id: response.id, text },
                    tools: SessionStopLoss.digest(parts, { directory: loaded.session.location.directory }),
                  }),
                )
                .pipe(
                  Effect.tap((record) =>
                    record
                      ? goals.recordReview(goal, {
                          id: record.id,
                          tokens: record.usage.input_tokens + record.usage.output_tokens,
                        })
                      : Effect.void,
                  ),
                  Effect.orElseSucceed(() => undefined),
                ),
            )
          : undefined
      const next = {
        ...current,
        stalled: !parts.some((part) => part.type === "tool") || judged === "stalled" ? current.stalled + 1 : 0,
        unavailable: judged === "unavailable" ? current.unavailable + 1 : 0,
      }
      if (judged === "blocked") {
        const reason =
          "System One confirmed the blocker reported in the last response. Resolve it, then resume the goal."
        yield* goals.save(goal, { ...goal, status: "blocked", reason })
        yield* guards.record({ sessionID, guard: "goal", action: "stop", subject: goal.id, detail: reason })
        return { memory: next, continued: false }
      }
      if (next.stalled >= SessionGoal.NO_PROGRESS_LIMIT || next.unavailable >= SessionGoal.JUDGE_FAILURE_LIMIT) {
        const stalled = next.stalled >= SessionGoal.NO_PROGRESS_LIMIT
        const reason = stalled
          ? `No verifiable progress after ${next.stalled} goal continuations. Refine the goal or resume it to try again.`
          : `System One could not judge goal progress ${next.unavailable} times in a row. Check its configuration, then resume the goal.`
        yield* goals.save(goal, { ...goal, status: "paused", reason })
        yield* guards.record({
          sessionID,
          guard: stalled ? "goal" : "intelligence",
          action: "stop",
          subject: goal.id,
          detail: reason,
        })
        return { memory: next, continued: false }
      }
      if (judged === "unavailable")
        yield* guards.record({
          sessionID,
          guard: "intelligence",
          action: "warn",
          subject: goal.id,
          detail: "System One could not judge goal progress; the goal continues unverified",
        })
      // New input admitted while System One judged takes the next boundary instead of a stale continuation.
      if (yield* SessionInbox.has(db, sessionID, "input")) return { memory: next, continued: false }
      yield* inbox
        .admitSynthetic({
          id: SessionMessage.ID.create(),
          sessionID,
          text: SessionGoal.continuation(goal, judged),
          description: `Continuing goal (step ${goal.turns.used + 1} of ${goal.turns.max})`,
          metadata: { [SessionGoal.CONTINUATION_KEY]: { goalID: goal.id, verdict: judged ?? "unjudged" } },
          delivery: "steer",
        })
        .pipe(Effect.orDie)
      return { memory: next, continued: true }
    })

    /**
     * Reviews the final response of a top-level Session with System One in dual reasoning. An
     * established issue earns one repair pass; what remains is kept with a durable note, and an
     * unavailable review is signalled instead of approving the response.
     */
    /**
     * What a review of the final response would look at, without acting on it: nothing to review, a repaired response
     * that changed nothing material, or the response to evaluate. Shared by the review and by its early start.
     */
    const planReview = Effect.fn("SessionRunner.planReview")(function* (
      loaded: SessionContext.Loaded,
      memory: ResponseReview,
    ) {
      const sessionID = loaded.session.id
      const settings = yield* intelligence.read(sessionID)
      const selfReview =
        loaded.agent.id === "build" &&
        Config.latestExperimental(yield* config.entries(), "reasoning_self_review") === true
      if (
        loaded.session.parentID ||
        !settings.enabled ||
        (IntelligenceEvaluation.mode(settings) === "single" && !selfReview)
      )
        return { type: "none" as const, memory }
      const recent = (yield* store.messages({ sessionID, order: "desc", limit: RECENT })).toReversed()
      const index = recent.findLastIndex((message) => message.type === "user")
      const user = (yield* store.messages({ sessionID, type: "user", limit: 1 }))[0]
      if (user?.type !== "user") return { type: "none" as const, memory }
      const current: ResponseReview = memory.userID === user.id ? memory : { userID: user.id, attempts: 0, issues: [] }
      const work = index < 0 ? recent : recent.slice(index + 1)
      const candidate = work.findLast((message) => message.type === "assistant")
      const text = candidate?.type === "assistant" ? responseText(candidate) : ""
      if (!candidate || !text) {
        if (current.attempts > 0)
          yield* noteReview(sessionID, {
            status: "unavailable",
            detail:
              "The bounded verification produced no replacement answer; inspect its tool evidence before proceeding",
            revised: false,
          })
        return { type: "none" as const, memory: current }
      }
      // A revision that changes nothing material settles nothing: the repaired issues stand.
      if (
        current.text !== undefined &&
        IntelligenceResponse.same(current.text, text) &&
        !(yield* codeRepairState(sessionID))
      )
        return { type: "unchanged" as const, current }
      return { type: "review" as const, current, user, work, candidate, text }
    })

    const evaluateReview = Effect.fn("SessionRunner.evaluateReview")(function* (
      loaded: SessionContext.Loaded,
      plan: {
        readonly current: ResponseReview
        readonly user: Extract<SessionMessage.Info, { type: "user" }>
        readonly work: ReadonlyArray<SessionMessage.Info>
        readonly candidate: SessionMessage.Info
        readonly text: string
      },
    ) {
      const sessionID = loaded.session.id
      const goal = yield* goals.get(sessionID)
      const classification = (yield* intelligence
        .history(sessionID, { operation: "prompt_classification", subjectID: plan.user.id, limit: 1 })
        .pipe(Effect.orElseSucceed(() => [])))[0]
      const projected = (yield* facts.load(sessionID)).results
      const entries = yield* config.entries()
      const codeEnabled =
        loaded.agent.id === "build" &&
        (Config.latestExperimental(entries, "reasoning_code_repair") === true ||
          Config.latestExperimental(entries, "reasoning_self_review") === true)
      const history = codeEnabled
        ? yield* store.messages({ sessionID, order: "asc", cursor: { id: plan.user.id, direction: "next" } })
        : []
      const scope = codeEnabled
        ? IntelligenceCodeRepair.scope(
            projected.filter((result) => history.some((message) => message.id === result.messageID)),
            loaded.session.location.directory,
          )
        : undefined
      const first = history.find((message) => message.type === "assistant" && message.snapshot?.start)
      const from = first?.type === "assistant" ? first.snapshot?.start : undefined
      const to = plan.candidate.type === "assistant" ? plan.candidate.snapshot?.end : undefined
      const scrub = yield* vault.scrubber(loaded.session.projectID)
      const files =
        scope && from && to
          ? yield* snapshot
              .diff({
                from,
                to,
                context: 10,
                paths: scope.paths.map((file) =>
                  RelativePath.make(path.relative(location.project.directory, file).replaceAll("\\", "/")),
                ),
              })
              .pipe(Effect.orElseSucceed(() => undefined))
          : undefined
      const artifact =
        files?.length && from && to ? IntelligenceCodeRepair.artifact({ from, to, files, scrub }) : undefined
      const evaluation = yield* intelligence
        .evaluate(
          IntelligenceResponse.evaluation({
            sessionID,
            request: { id: plan.user.id, text: plan.user.text },
            candidate: { id: plan.candidate.id, text: plan.text },
            attempt: plan.current.attempts,
            tools: SessionTaskFacts.evidence(projected),
            scrub,
            artifact,
            tasks: SessionTodo.forAgent(yield* todos.get(sessionID), loaded.agent.id).map((task) => ({
              content: task.content,
              status: task.status,
              ...(task.reason ? { reason: task.reason } : {}),
            })),
            goal: goal ? { objective: goal.objective, status: goal.status, reason: goal.reason } : undefined,
            route: IntelligenceClassification.workRoute(classification),
          }),
        )
        .pipe(Effect.orElseSucceed(() => undefined))
      return {
        evaluation,
        scope: artifact ? scope : undefined,
        checked: artifact && scope ? IntelligenceCodeRepair.verified(projected, scope) : undefined,
      }
    })

    /**
     * Starts the response review while an active goal is still being judged, so the two System One requests run
     * side by side instead of one after the other. Joined by `reviewResponse` when the goal does not continue, and
     * interrupted when it does.
     */
    const startReview = Effect.fn("SessionRunner.startReview")(function* (
      loaded: SessionContext.Loaded,
      memory: ResponseReview,
    ) {
      if (loaded.session.parentID || (yield* goals.get(loaded.session.id))?.status !== "active") return undefined
      const plan = yield* planReview(loaded, memory)
      if (plan.type !== "review") return undefined
      return yield* Effect.forkChild(evaluateReview(loaded, plan))
    })

    const reviewResponse = Effect.fn("SessionRunner.reviewResponse")(function* (
      loaded: SessionContext.Loaded,
      memory: ResponseReview,
      started?: Fiber.Fiber<
        Effect.Success<ReturnType<typeof evaluateReview>>,
        Effect.Error<ReturnType<typeof evaluateReview>>
      >,
    ) {
      const sessionID = loaded.session.id
      const plan = yield* planReview(loaded, memory)
      // Whatever changed since it started, a review that is not going to be joined is not left running.
      if (started && plan.type !== "review") yield* Fiber.interrupt(started)
      if (plan.type === "none") return { memory: plan.memory, repair: false }
      const current = plan.current
      const settled = { ...current, text: undefined }
      const revised = current.attempts > 0
      if (plan.type === "unchanged") {
        yield* noteReview(sessionID, {
          status: "unresolved",
          issues: current.issues,
          confidence: {},
          revised,
        })
        return { memory: settled, repair: false }
      }
      const { user, candidate, text } = plan
      const inspected = started ? yield* Fiber.join(started) : yield* evaluateReview(loaded, plan)
      const evaluation = inspected.evaluation
      const mode = IntelligenceEvaluation.mode(yield* intelligence.read(sessionID))
      if (mode === "observe") return { memory: settled, repair: false }
      const verdict = IntelligenceResponse.verdict(evaluation, current.issues)
      const selfReview =
        mode === "single" &&
        Config.latestExperimental(yield* config.entries(), "reasoning_self_review") === true &&
        inspected.scope !== undefined
      if (
        revised &&
        evaluation?.decision === "accepted" &&
        Config.latestExperimental(yield* config.entries(), "reasoning_learning") === true
      ) {
        const prior = (yield* intelligence.history(sessionID, {
          operation: "response_quality",
          subjectID: user.id,
          limit: 10,
        })).find(
          (entry) =>
            entry.id !== evaluation.id && entry.candidateID !== evaluation.candidateID && entry.mode !== "observe",
        )
        const learning = IntelligenceLearning.candidate(prior, evaluation)
        const evidence = SessionTaskFacts.evidence((yield* facts.load(sessionID)).results)
        if (learning && evidence.calls.some((call) => call.kind === "verification" && call.fresh))
          yield* artifacts
            .save(learning)
            .pipe(Effect.catchCause((cause) => Effect.logWarning("Learning proposal unavailable", { cause })))
      }
      if (
        (verdict.repair.length || selfReview) &&
        current.attempts < IntelligenceResponse.REPAIRS &&
        !(yield* codeRepairState(sessionID))
      ) {
        // New input admitted while System One reviewed supersedes the repair.
        if (yield* SessionInbox.has(db, sessionID, "input")) return { memory: settled, repair: false }
        const codeIssues = selfReview ? ["self_review"] : IntelligenceCodeRepair.issues(evaluation)
        const scope = codeIssues.length ? inspected.scope : undefined
        yield* bus.publish(SessionEvent.Synthetic, {
          sessionID,
          text: scope
            ? IntelligenceCodeRepair.prompt(codeIssues, scope)
            : Config.latestExperimental(yield* config.entries(), "reasoning_verification") === true
              ? IntelligenceVerification.prompt(
                  verdict.repair,
                  SessionTaskFacts.evidence((yield* facts.load(sessionID)).results),
                )
              : IntelligenceResponse.repairPrompt(verdict.repair),
          description: selfReview
            ? "Independently reviewing the implementation with S2"
            : `Revising the response after S1 review: ${verdict.repair.map(IntelligenceResponse.reason).join("; ")}`,
          metadata: {
            ...(scope ? { [IntelligenceCodeRepair.KEY]: { userID: user.id, scope } } : {}),
            ...(!scope && Config.latestExperimental(yield* config.entries(), "reasoning_verification") === true
              ? { [IntelligenceVerification.KEY]: { userID: user.id, candidateID: candidate.id } }
              : {}),
            [IntelligenceResponse.REPAIR_KEY]: {
              candidateID: candidate.id,
              issues: verdict.repair,
              confidence: IntelligenceResponse.confidence(evaluation, verdict.repair),
              ...(evaluation ? { evaluationID: evaluation.id } : {}),
            },
          },
        })
        return {
          memory: {
            userID: user.id,
            attempts: current.attempts + 1,
            issues: [...current.issues, ...verdict.repair],
            text,
          },
          repair: true,
        }
      }
      if (mode === "single") return { memory: settled, repair: false }
      if (!evaluation || evaluation.decision === "unavailable")
        yield* noteReview(sessionID, {
          status: "unavailable",
          ...(evaluation ? { evaluationID: evaluation.id } : {}),
          detail: evaluation ? IntelligenceEvaluation.issueSummary(evaluation) : "the evaluation could not run",
          revised,
        })
      if (evaluation && evaluation.decision !== "unavailable" && verdict.unresolved.length)
        yield* noteReview(sessionID, {
          status: "unresolved",
          evaluationID: evaluation.id,
          issues: verdict.unresolved,
          confidence: IntelligenceResponse.confidence(evaluation, verdict.unresolved),
          revised,
        })
      const codeRepair = yield* codeRepairState(sessionID)
      if (revised && codeRepair && !inspected.checked)
        yield* noteReview(sessionID, {
          status: "unavailable",
          detail: "Code review ended without a fresh successful allowed test after the latest edit",
          revised,
        })
      if (
        evaluation?.decision === "accepted" &&
        !verdict.unresolved.length &&
        revised &&
        (!codeRepair || inspected.checked)
      )
        yield* noteReview(sessionID, { status: "revised", issues: current.issues })
      if (evaluation?.decision === "inconclusive" && !verdict.unresolved.length && revised)
        yield* noteReview(sessionID, {
          status: "unavailable",
          detail: "The revised candidate has no established issue, but S1 review remains inconclusive",
          revised,
        })
      return { memory: settled, repair: false }
    })

    const noteReview = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      outcome: IntelligenceResponse.Outcome,
    ) {
      const note = IntelligenceResponse.note(outcome)
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text: note.text,
        description: note.description,
        metadata: { [IntelligenceResponse.REVIEW_KEY]: outcome },
      })
      if (outcome.status !== "revised")
        yield* guards.record({
          sessionID,
          guard: "intelligence",
          action: "warn",
          subject: "response_quality",
          detail: note.text,
        })
    })

    const learnOverflow = Effect.fnUntraced(function* (
      loaded: SessionContext.Loaded,
      request: SessionModelRequest.Prepared["request"],
      failure: unknown,
    ) {
      const message =
        failure instanceof AIError
          ? [failure.reason.message, "body" in failure.reason ? failure.reason.body : undefined]
              .filter(Boolean)
              .join("\n")
          : Schema.is(ProviderErrorEvent)(failure)
            ? failure.message
            : ""
      const numbers = contextOverflowNumbers(message)
      if (!numbers) return
      const observed = ModelLimit.fromNumbers({
        numbers,
        output: request.generation?.maxTokens ?? loaded.model.limit.output,
        estimated: request.messages.some((item) => item.content.some((part) => part.type === "media"))
          ? undefined
          : SessionCompaction.estimateRequest(request),
        declared: { context: loaded.model.limit.context, input: loaded.model.limit.input },
        message: message.split("\n")[0] ?? message,
      })
      if (!observed) return
      yield* limits.learn(loaded.model.ref.providerID, loaded.model.ref.id, observed)
      yield* Effect.logInfo("learned provider input limit", {
        sessionID: loaded.session.id,
        providerID: loaded.model.ref.providerID,
        modelID: loaded.model.ref.id,
        limit: observed.limit,
        counted: observed.counted,
        estimated: observed.estimated,
      })
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      first: SessionContext.Loaded,
      step: number,
      goalID: string | undefined,
      advice: string,
      stopGuard: () => void,
    ) {
      const sessionID = first.session.id
      const verifying = (yield* verificationState(sessionID))?.pending === true
      const codeRepair = yield* codeRepairState(sessionID)
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* SessionRunnerRetry.make(bus, sessionID)
      let initial: SessionContext.Loaded | undefined = first
      let recoverOverflow = true
      let recoverContinuation = true
      while (true) {
        // Reuse boundary preparation once; retries refresh context without delivering more input.
        const loaded = initial ?? (yield* prepareContext(sessionID).pipe(Effect.flatMap(context.load)))
        initial = undefined
        const compacted = yield* compaction.compact({ reason: "auto", context: loaded })
        if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
        if (compacted.status === "completed") {
          assistantMessageID = SessionMessage.ID.create()
          continue
        }
        const limit = stepLimit(
          loaded.agent.info.steps,
          Config.latestExperimental(yield* config.entries(), "turn_steps"),
        )
        const stepLimitReached = limit !== undefined && step >= limit
        const loopLimits = LoopGuard.limits(Config.latestExperimental(yield* config.entries(), "loop_guard"))
        const latestUser = (yield* store.messages({ sessionID, type: "user", limit: 1 })).at(0)
        const stallLimits = SessionStall.limits(Config.latestExperimental(yield* config.entries(), "turn_stall"), {
          attended: SessionStall.attended(
            latestUser?.type === "user" && typeof latestUser.metadata?.source === "string"
              ? latestUser.metadata.source
              : (process.env.OPENCODE_CLIENT ?? ""),
          ),
        })
        const toolTimeout = Config.latestExperimental(yield* config.entries(), "tool_timeout")
        if (stepLimitReached)
          yield* guards.record({
            sessionID,
            guard: "steps",
            action: "stop",
            subject: loaded.agent.id,
            detail: `Tools disabled at agent step ${step} of ${limit}`,
          })
        const tools = codeRepair?.pending
          ? IntelligenceCodeRepair.restrict(
              yield* registry.snapshot(Permission.forAgent(loaded.agent.info, loaded.session.permissions), {
                codeMode: false,
              }),
              codeRepair.scope,
              codeRepair.remaining === 1,
            )
          : verifying
            ? IntelligenceVerification.restrict(
                yield* registry.snapshot(Permission.forAgent(loaded.agent.info, loaded.session.permissions), {
                  codeMode: false,
                }),
              )
            : loaded.tools
        const curation =
          !verifying &&
          !codeRepair?.pending &&
          loaded.model.compaction?.type !== "native" &&
          Config.latestExperimental(yield* config.entries(), "reasoning_context_curation") === true &&
          (yield* dual(sessionID)) &&
          SessionContextCuration.candidates(loaded.messages).length > 0
            ? yield* intelligence
                .evaluate(
                  SessionContextCuration.evaluation(
                    sessionID,
                    loaded.messages,
                    JSON.stringify({
                      initial: loaded.initial,
                      goal: yield* goals.get(sessionID),
                      plans: yield* plans.list(sessionID),
                      tasks: yield* todos.get(sessionID),
                    }),
                    yield* vault.scrubber(loaded.session.projectID),
                  ),
                )
                .pipe(Effect.orElseSucceed(() => undefined))
            : undefined
        const proposed =
          (yield* dual(sessionID)) && !(yield* SessionInbox.has(db, sessionID, "steer"))
            ? SessionContextCuration.apply(loaded.messages, curation)
            : { messages: loaded.messages, omitted: [] }
        const recorded =
          proposed.omitted.length && curation
            ? yield* artifacts
                .save({
                  type: "curation",
                  id: curation.id,
                  sessionID,
                  subjectID: curation.subjectID ?? sessionID,
                  policy: curation.policy,
                  created: curation.created,
                  omitted: proposed.omitted,
                })
                .pipe(
                  Effect.as(true),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Context curation manifest unavailable", { sessionID, cause }).pipe(
                      Effect.as(false),
                    ),
                  ),
                )
            : false
        const curated = recorded ? proposed : { messages: loaded.messages, omitted: [] }
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools,
          initial: loaded.initial,
          messages: curated.messages,
          prune: loaded.prune,
        })
        // A subagent works toward its parent's live goal without owning, spending or completing it.
        const inherited = loaded.session.parentID ? yield* goals.inherited(loaded.session.parentID) : undefined
        const guidance = [
          SessionGoal.guidance(yield* goals.get(sessionID)),
          inherited ? SessionGoal.inherit(inherited) : "",
          SessionPlan.guidance(yield* plans.list(sessionID)),
          advice,
          codeRepair?.pending
            ? `Code review allowance: ${codeRepair.remaining} Steps remain. ${codeRepair.remaining === 1 ? "This is the final Step: report actual changes, tests and any unresolved defect; tools are disabled." : "Check the suspected defect, make a focused correction only if confirmed, and run the allowed test after editing."}`
            : "",
          curated.omitted.length
            ? `Context curation omitted ${curated.omitted.length} old read-only assistant blocks. Originals remain available through session_history with these message IDs: ${curated.omitted.map((item) => item.messageID).join(", ")}. Inspect the manifest ${curation?.id} through /intelligence. Never infer that omitted work was verified.`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n")
        const prepared = yield* context.request
          .primary({
            session: loaded.session,
            agent: loaded.agent.id,
            model: loaded.model,
            tools,
            system: guidance ? [...transcript.system, SystemPart.make(guidance)] : transcript.system,
            messages: stepLimitReached
              ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
              : transcript.messages,
            // Keep tool definitions on the final Step to preserve the provider's cached prefix.
            toolChoice: stepLimitReached ? "none" : undefined,
            webSocket: "session",
            inputTokens: SessionCompaction.estimatePrompt(loaded),
          })
          .pipe(
            Effect.map((prepared) =>
              verifying || codeRepair?.pending
                ? {
                    ...prepared,
                    request: {
                      ...prepared.request,
                      generation: {
                        ...prepared.request.generation,
                        maxTokens: Math.min(
                          IntelligenceCodeRepair.MAX_TOKENS,
                          prepared.request.generation?.maxTokens ?? IntelligenceCodeRepair.MAX_TOKENS,
                        ),
                      },
                    },
                  }
                : prepared,
            ),
          )
        const output = prepared.request.generation?.maxTokens ?? loaded.model.limit.output
        const declared = { context: loaded.model.limit.context, input: loaded.model.limit.input }
        const observed = yield* limits.get(loaded.model.ref.providerID, loaded.model.ref.id, declared)
        if (observed && !prepared.request.messages.some((item) => item.content.some((part) => part.type === "media"))) {
          const inputLimit = ModelLimit.effectiveInput(
            { input: loaded.model.limit.input || loaded.model.limit.context },
            observed,
            output,
          )
          const estimated = ModelLimit.calibrate(SessionCompaction.estimateRequest(prepared.request), observed)
          if (inputLimit !== undefined && estimated > inputLimit)
            return yield* new StepFailedError({
              error: {
                type: "provider.context-overflow",
                message: ModelLimit.doomed({
                  providerID: loaded.model.ref.providerID,
                  limit: inputLimit,
                  estimated,
                }),
              },
            })
        }
        const outcome = yield* steps.attempt({
          isLocationClosed: lifecycle.isClosed,
          sessionID,
          goalID,
          assistantMessageID,
          agent: loaded.agent.id,
          model: loaded.model,
          prepared,
          retry: (cause, error, proposed) =>
            retry.decide({
              cause,
              error,
              agent: loaded.agent.id,
              model: loaded.model.ref,
              hook: prepared.retry,
              retry: proposed,
            }),
          recoverContinuation,
          recoverOverflow: Effect.fnUntraced(function* (failure: unknown) {
            yield* learnOverflow(loaded, prepared.request, failure)
            if (!recoverOverflow) return false
            return (yield* compaction.compact({ reason: "overflow", context: loaded })).status === "completed"
          }),
          accepted: Effect.fnUntraced(function* (accepted: number) {
            const observed = yield* limits.get(loaded.model.ref.providerID, loaded.model.ref.id, declared)
            if (!observed) return
            const raised = ModelLimit.raised(observed, accepted, output)
            if (raised) yield* limits.learn(loaded.model.ref.providerID, loaded.model.ref.id, raised)
          }),
          allowLoop: (tool) =>
            Permission.evaluate(
              "doom_loop",
              tool,
              Permission.forAgent(loaded.agent.info, loaded.session.permissions ?? []),
            ).effect === "allow",
          loopLimits,
          stallLimits,
          toolTimeout,
        })
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Completed: Effect.fnUntraced(function* (outcome) {
            if (outcome.guardStop) {
              stopGuard()
              const goal = yield* goals.get(sessionID)
              if (goal?.status === "active")
                yield* goals.save(goal, { ...goal, status: "paused", reason: outcome.guardStop }).pipe(Effect.orDie)
            }
            return outcome.needsContinuation
          }),
          Retry: (outcome) =>
            retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            }),
          Continue: Effect.fnUntraced(function* (outcome) {
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_INCOMPLETE_STREAM })
            assistantMessageID = SessionMessage.ID.create()
          }),
          Compacted: Effect.fnUntraced(function* () {
            recoverOverflow = false
            assistantMessageID = SessionMessage.ID.create()
          }),
          RecoverFull: Effect.fnUntraced(function* () {
            recoverContinuation = false
          }),
        })
        if (completed !== undefined) return completed
      }
    })

    const settleStaleCompactions = Effect.fn("SessionRunner.settleStaleCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // A process death skips compaction finalizers. Include orphans behind a
      // completed checkpoint, and settle newest first to match event projection.
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, "compaction"),
            sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const message = yield* SessionHistory.decodeMessageRow(row)
        if (message.type !== "compaction") continue
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason: message.reason,
          inputID: message.id,
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        })
      }
    })

    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* store.context(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
          const childID =
            tool.name === "subagent" && typeof metadata?.sessionID === "string" ? metadata.sessionID : undefined
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            id: tool.id,
            error: {
              type: "aborted",
              message: `Tool execution interrupted: ${tool.name}${childID ? ` (sessionID: ${childID})` : ""}`,
            },
            ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
            executed: tool.executed === true,
          })
        }
      }
    })

    // Work prepared in the background for a later compaction does not outlive the drain that started it.
    return Service.of({
      drain: (input) => drain(input).pipe(Effect.ensuring(compaction.discard(input.sessionID))),
    })
  }),
)

/** The visible text of an assistant message. */
function responseText(message: SessionMessage.Assistant) {
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    HookRuntime.node,
    Bus.node,
    LocationLifecycle.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionCompaction.node,
    Plugin.node,
    Permission.node,
    Config.node,
    IntelligenceArtifacts.node,
    Intelligence.node,
    SessionTaskFacts.node,
    SessionTitle.node,
    SessionTodoStore.node,
    SessionGoal.node,
    SessionBudget.node,
    SessionGuardLog.node,
    SessionPlan.node,
    SessionGoalCompletion.node,
    MonitorRuntime.node,
    SessionInbox.node,
    Job.node,
    Skill.node,
    Snapshot.node,
    ToolOutput.node,
    Tool.node,
    Database.node,
    DesignStore.node,
    Location.node,
    Global.node,
    Vault.node,
    modelLimitNode,
  ],
})
