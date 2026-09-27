export * as SessionRunnerLLM from "./llm.js"

import { AIError, Message, ProviderErrorEvent, SystemPart } from "@opencode/ai"
import { Monitor } from "@opencode/schema/monitor"
import { and, desc, eq, sql } from "drizzle-orm"
import { Cause, Clock, Effect, Exit, FiberMap, Layer, Schema } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { ModelLimit } from "../../model-limit.js"
import { contextOverflowNumbers } from "../../model-limit-numbers.js"
import { modelLimitNode } from "#model-limit-node"
import { LocationLifecycle } from "../../location-lifecycle.js"
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
import { SessionGuardLog } from "../guard-log.js"
import { SessionPlan } from "../plan.js"
import { SessionGoalCompletion } from "../goal-completion.js"
import { SessionTodo } from "../todo.js"
import { SessionTodoStore } from "../todo-store.js"
import { MonitorRuntime } from "../../monitor.js"
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
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

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
    const guards = yield* SessionGuardLog.Service
    const intelligence = yield* Intelligence.Service
    const plans = yield* SessionPlan.Service
    const monitors = yield* MonitorRuntime.Service
    const steps = yield* SessionStep.make
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    const drain = Effect.fn("SessionRunner.drain")(function* (input: Parameters<Interface["drain"]>[0]) {
      const sessionID = input.sessionID
      let force = input.force
      let continuing = input.continuation !== undefined
      let step = input.continuation?.step ?? 1
      let entering = true
      let todoContinuations = 0
      let guardStopped = false
      let stopLoss = SessionStopLoss.FRESH
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
        const goalID = yield* goals.beginStep(sessionID)
        if (goalID === false) return DrainResult.Complete()
        const result = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const result = yield* restore(runStep(next.context, step, goalID)).pipe(Effect.exit)
            if (goalID)
              yield* goals
                .settle(sessionID, {
                  goalID,
                  tokens: 0,
                  interrupted: Exit.isFailure(result) && Cause.hasInterrupts(result.cause),
                  failed: Exit.isFailure(result) && !Cause.hasInterrupts(result.cause),
                  waiting: Exit.isSuccess(result) && (yield* monitors.list(sessionID)).some(Monitor.parks),
                })
                .pipe(Effect.catchAllCause((cause) => Effect.logWarning("Goal step settlement failed", { sessionID, cause: Cause.pretty(cause) })))
            return result
          }),
        )
        if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause)
        continuing = result.value
        if (
          continuing &&
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
          !guardStopped &&
          next.context.agent.id !== "question" &&
          !(yield* SessionInbox.nextPromotable(db, sessionID, "steer")) &&
          !(yield* monitors.list(sessionID)).some(Monitor.parks) &&
          (next.context.agent.info.steps === undefined || step < next.context.agent.info.steps)
        ) {
          const reminder = SessionTodo.reminder(
            yield* todos.review(sessionID).pipe(Effect.orElse(() => todos.get(sessionID))),
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
        step++
        force = false
        entering = false
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      const selected = yield* context.select(sessionID)
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
      const settings = yield* intelligence.read()
      const asked = settings.enabled && IntelligenceEvaluation.mode(settings) === "dual"
      const remembered = memory === SessionStopLoss.FRESH ? (SessionStopLoss.recover(messages) ?? memory) : memory
      const current = SessionStopLoss.current(remembered, step, trajectory.idle)
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
      if (verdict.action === "continue") return { memory: next, ended: false }
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
          [SessionStopLoss.METADATA_KEY]: { ...SessionStopLoss.notice(trajectory, verdict, { subagent }), memory: next },
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

    const learnOverflow = Effect.fnUntraced(function* (
      loaded: SessionContext.Loaded,
      request: SessionModelRequest.Prepared["request"],
      failure: unknown,
    ) {
      const message = failure instanceof AIError
        ? [failure.reason.message, "body" in failure.reason ? failure.reason.body : undefined].filter(Boolean).join("\n")
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
    ) {
      const sessionID = first.session.id
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
        const stepLimitReached = loaded.agent.info.steps !== undefined && step >= loaded.agent.info.steps
        const loopLimits = LoopGuard.limits(Config.latestExperimental(yield* config.entries(), "loop_guard"))
        const latestUser = (yield* store.messages({ sessionID, type: "user", limit: 1 })).at(0)
        const stallLimits = SessionStall.limits(Config.latestExperimental(yield* config.entries(), "turn_stall"), {
          attended: SessionStall.attended(
            latestUser?.type === "user" && typeof latestUser.metadata?.source === "string"
              ? latestUser.metadata.source
              : process.env.OPENCODE_CLIENT ?? "",
          ),
        })
        const toolTimeout = Config.latestExperimental(yield* config.entries(), "tool_timeout")
        if (stepLimitReached && loaded.agent.info.steps !== undefined)
          yield* guards.record({
            sessionID,
            guard: "steps",
            action: "stop",
            subject: loaded.agent.id,
            detail: `Tools disabled at agent step ${step} of ${loaded.agent.info.steps}`,
          })
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools: loaded.tools,
          initial: loaded.initial,
          messages: loaded.messages,
          prune: loaded.prune,
        })
        const guidance = [
          SessionGoal.guidance(yield* goals.get(sessionID)),
          SessionPlan.guidance(yield* plans.list(sessionID)),
        ].filter(Boolean).join("\n\n")
        const prepared = yield* context.request.primary({
          session: loaded.session,
          agent: loaded.agent.id,
          model: loaded.model,
          tools: loaded.tools,
          system: guidance ? [...transcript.system, SystemPart.make(guidance)] : transcript.system,
          messages: stepLimitReached
            ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
            : transcript.messages,
          // Keep tool definitions on the final Step to preserve the provider's cached prefix.
          toolChoice: stepLimitReached ? "none" : undefined,
          webSocket: "session",
        })
        const output = prepared.request.generation?.maxTokens ?? loaded.model.limit.output
        const declared = { context: loaded.model.limit.context, input: loaded.model.limit.input }
        const observed = yield* limits.get(loaded.model.ref.providerID, loaded.model.ref.id, declared)
        if (
          observed &&
          !prepared.request.messages.some((item) => item.content.some((part) => part.type === "media"))
        ) {
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
            Permission.evaluate("doom_loop", tool, loaded.agent.info.permissions, loaded.session.permissions ?? []).effect ===
            "allow",
          loopLimits,
          stallLimits,
          toolTimeout,
        })
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Completed: Effect.fnUntraced(function* (outcome) {
            if (outcome.guardStop) {
              guardStopped = true
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

    return Service.of({ drain })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    LocationLifecycle.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionCompaction.node,
    Plugin.node,
    Config.node,
    Intelligence.node,
    SessionTitle.node,
    SessionTodoStore.node,
    SessionGoal.node,
    SessionGuardLog.node,
    SessionPlan.node,
    SessionGoalCompletion.node,
    MonitorRuntime.node,
    Snapshot.node,
    ToolOutput.node,
    Database.node,
    modelLimitNode,
  ],
})
