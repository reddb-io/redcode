import { Context, Duration, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Shell } from "@reddb-io/redcode-core/shell"
import { LLMEvent } from "@reddb-io/redcode-llm"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { AuxDeadline } from "./aux-deadline"
import { SessionGoal } from "./goal"
import { SessionGuardLog } from "./guard-log"
import type { SessionID } from "./schema"
import { Session } from "./session"
import { Process } from "@/util/process"

/**
 * The goal loop's impure half: where the goal is kept, how the judge is asked, how gates run.
 *
 * The decisions themselves are in `goal.ts` and take values; this file only fetches those
 * values and writes the results back. Everything here fails open: a judge that cannot answer
 * is a CONTINUE with a warning on the guard log, a gate that cannot run is a failed gate with
 * the error as its output, and none of it can fail the turn it hangs off.
 */

export interface AfterTurnInput {
  readonly session: Session.Info
  readonly lastUser: SessionV1.User
  readonly lastAssistant: SessionV1.WithParts | undefined
}

export interface AfterTurnResult {
  readonly action: SessionGoal.Action
  /** The synthetic user message that starts the next turn, on a continuation. */
  readonly text?: string
  readonly goal: SessionGoal.Goal
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<SessionGoal.Goal | undefined>
  readonly set: (sessionID: SessionID, goal: SessionGoal.Goal | undefined) => Effect.Effect<void>
  readonly claim: (sessionID: SessionID, evidence: string) => Effect.Effect<void>
  /** Active → paused with a reason; anything else untouched. */
  readonly pause: (sessionID: SessionID, reason: string) => Effect.Effect<SessionGoal.Goal | undefined>
  readonly block: (sessionID: SessionID, reason: string) => Effect.Effect<void>
  /** Before a provider attempt: false when the budget has no turn left; spends nothing. */
  readonly beginTurn: (sessionID: SessionID) => Effect.Effect<boolean>
  /** The end of a turn: gates, judge, decision, record. The one place a turn is spent. */
  readonly afterTurn: (input: AfterTurnInput) => Effect.Effect<AfterTurnResult | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/GoalRuntime") {}

/** How much of the last answer the judge reads. Enough for a report; not the whole turn. */
const JUDGE_ANSWER_CHARS = 8_000
const GATE_OUTPUT_CHARS = 20_000

const answerOf = (message: SessionV1.WithParts | undefined) =>
  (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []))
    .join("\n\n")
    .slice(-JUDGE_ANSWER_CHARS)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const config = yield* Config.Service
    const guards = yield* SessionGuardLog.Service
    const jobs = yield* BackgroundJob.Service

    const get = Effect.fn("GoalRuntime.get")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
      return SessionGoal.fromMetadata(session?.metadata)
    })

    const set = Effect.fn("GoalRuntime.set")(function* (sessionID: SessionID, goal: SessionGoal.Goal | undefined) {
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      // An active goal always names the process driving it, so a later process can tell it was
      // not the one — and pause rather than pick the loop up on its own.
      const stamped = goal && goal.status === "active" ? { ...goal, boot: SessionGoal.BOOT } : goal
      yield* sessions.setMetadata({ sessionID, metadata: SessionGoal.toMetadata(session.metadata, stamped) })
    })

    // Admission only: the budget is spent in `afterTurn`, once per judged turn. This runs before
    // every provider attempt — each tool round-trip, each retry — and used to charge each one, so
    // a turn that read fifteen files spent fifteen turns of a budget that said twenty.
    const beginTurn = Effect.fn("GoalRuntime.beginTurn")(function* (sessionID: SessionID) {
      const goal = yield* get(sessionID)
      if (!goal || goal.status !== "active") return true
      if (goal.turns.used < goal.turns.max) return true
      yield* set(sessionID, SessionGoal.paused(goal, SessionGoal.budgetReason(goal), Date.now()))
      return false
    })

    const claim = Effect.fn("GoalRuntime.claim")(function* (sessionID: SessionID, evidence: string) {
      const goal = yield* get(sessionID)
      if (!goal || goal.status !== "active") return
      yield* set(sessionID, { ...goal, claimed: { evidence, at: Date.now() }, updated: Date.now() })
    })

    const pause = Effect.fn("GoalRuntime.pause")(function* (sessionID: SessionID, reason: string) {
      const goal = yield* get(sessionID)
      if (!goal || goal.status !== "active") return goal
      const next = SessionGoal.paused(goal, reason, Date.now())
      yield* set(sessionID, next)
      yield* guards.record({ sessionID, guard: "goal", action: "stop", subject: "paused", detail: reason })
      return next
    })

    const block = Effect.fn("GoalRuntime.block")(function* (sessionID: SessionID, reason: string) {
      const goal = yield* get(sessionID)
      if (!goal || goal.status !== "active") return
      yield* set(sessionID, { ...goal, status: "blocked", reason, updated: Date.now() })
      yield* guards.record({ sessionID, guard: "goal", action: "stop", subject: "blocked", detail: reason })
    })

    /** Gates run in the instance directory, each bounded; a gate that cannot run has failed. */
    const gates = Effect.fn("GoalRuntime.gates")(function* (goal: SessionGoal.Goal) {
      if (goal.gates.length === 0) return [] as SessionGoal.Gates[]
      const ctx = yield* InstanceState.context
      const cfg = yield* config.get()
      const timeout = cfg.experimental?.goal?.gate_timeout ?? 300_000
      const sh = Shell.preferred(cfg.shell)
      const out: SessionGoal.Gates[] = []
      for (const command of goal.gates) {
        const result = yield* Effect.promise(() =>
          Process.text([command], { shell: sh, cwd: ctx.directory, nothrow: true, timeout }).then(
            (r) => ({ ok: r.code === 0, output: (r.text + "\n" + r.stderr.toString()).slice(-GATE_OUTPUT_CHARS) }),
            (error: unknown) => ({ ok: false, output: error instanceof Error ? error.message : String(error) }),
          ),
        )
        out.push({ command, ...result })
        if (!result.ok) break
      }
      return out
    })

    /** One short request against a small model. Unreadable or unanswered is `undefined`. */
    const judge = Effect.fn("GoalRuntime.judge")(function* (input: {
      session: Session.Info
      goal: SessionGoal.Goal
      lastUser: SessionV1.User
      answer: string
      background: readonly string[]
      evidence: string
    }) {
      const ag = yield* agents.get("goal_judge")
      if (!ag) return undefined
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.lastUser.model.providerID)) ??
          (yield* provider.getModel(input.lastUser.model.providerID, input.lastUser.model.modelID)))
      const cfg = yield* config.get()
      const ms = AuxDeadline.deadlineMs("judge", cfg.experimental?.goal?.judge_timeout)
      const { goal } = input
      const content = [
        "<goal>",
        `Objective: ${goal.objective}`,
        ...(goal.contract.outcome ? [`Outcome: ${goal.contract.outcome}`] : []),
        ...(goal.contract.verification ? [`Verification: ${goal.contract.verification}`] : []),
        ...(goal.contract.constraints ? [`Constraints: ${goal.contract.constraints}`] : []),
        ...(goal.contract.boundaries ? [`Boundaries: ${goal.contract.boundaries}`] : []),
        ...(goal.contract.stop_when ? [`Stop when: ${goal.contract.stop_when}`] : []),
        ...(goal.gates.length ? [`Gates (all passed this turn): ${goal.gates.join(" && ")}`] : []),
        `Turn ${goal.turns.used + 1} of ${goal.turns.max}.`,
        "</goal>",
        "",
        goal.claimed
          ? `<claim>\nThe agent called goal_complete with this evidence:\n${goal.claimed.evidence}\n</claim>`
          : "<claim>The agent did not claim completion this turn.</claim>",
        "",
        `<observed-evidence>\n${input.evidence || "No executed checks or completed tools."}\n</observed-evidence>`,
        `<last-turn>\n${input.answer || "(the agent produced no text this turn)"}\n</last-turn>`,
        "",
        input.background.length
          ? `<background>Work still running for this session: ${input.background.join("; ")}</background>`
          : "<background>No background work is running.</background>",
        "",
        'Reply with one JSON object: {"verdict": "done|continue|blocked|wait", "reason": "..."}',
      ].join("\n")

      const text = yield* llm
        .stream({
          agent: ag,
          user: input.lastUser,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          // A judge that errors is a judge that did not answer: the loop continues and says so.
          Effect.catchCause((cause) =>
            Effect.logWarning("goal judge failed", { "session.id": input.session.id, cause }).pipe(Effect.as("")),
          ),
          ms === undefined
            ? (self) => self
            : Effect.timeoutOrElse({
                duration: Duration.millis(ms),
                orElse: () =>
                  guards
                    .record({
                      sessionID: input.session.id,
                      guard: "goal",
                      action: "warn",
                      subject: "judge",
                      detail: AuxDeadline.message("judge", ms),
                    })
                    .pipe(Effect.as("")),
              }),
        )
      return SessionGoal.parseVerdict(text)
    })

    const afterTurn = (input: AfterTurnInput): Effect.Effect<AfterTurnResult | undefined> =>
      Effect.gen(function* () {
        const goal = SessionGoal.fromMetadata(input.session.metadata)
        if (!goal || goal.status !== "active") return undefined
        const sessionID = input.session.id
        const now = Date.now()

        const running = (yield* jobs.list()).filter(
          (job) => job.status === "running" && job.metadata?.["parentSessionId"] === sessionID,
        )
        const background = running.map((job) => String(job.metadata?.["description"] ?? job.id))

        if (running.length) return { action: "wait" as const, goal }
        const gateResults = yield* gates(goal)
        const failed = gateResults.find((g) => !g.ok)
        const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
        // Only this turn's tool results count: anything since the goal was set would let one
        // `read` on the first turn stand as evidence for every later claim. The turn starts where
        // the last one was spent, not at the last user message: a turn parked on background work
        // spends nothing, and the report that re-enters it is the same turn.
        const since = goal.judged ?? goal.created
        const observed = messages
          .filter((message) => message.info.time.created >= since)
          .flatMap((message) =>
            message.parts.flatMap((part) =>
              part.type === "tool" && part.tool !== "goal_complete" && part.state.status === "completed"
                ? [`${part.tool}: ${part.state.output}`]
                : [],
            ),
          )
        const evidence = SessionGoal.evidence(gateResults, observed)
        const verdict = failed
          ? undefined
          : yield* judge({
              session: input.session,
              goal,
              lastUser: input.lastUser,
              answer: answerOf(input.lastAssistant),
              background,
              evidence,
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("goal judge could not run", { "session.id": sessionID, cause }).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
        // The decision is taken on a record and written back only if that record is still the
        // one stored: `/goal-budget` and `/goal-resume` write the same record from another fiber.
        const record = Effect.fn("GoalRuntime.record")(function* (base: SessionGoal.Goal) {
          const decision = SessionGoal.decide({
            goal: base,
            ...(verdict ? { verdict } : {}),
            gates: gateResults,
            waiting: running.length > 0,
            evidence: evidence.length > 0,
          })
          // A failed gate is not a judge failure: the judge was never asked.
          const next = SessionGoal.apply(
            base,
            decision,
            failed ? { verdict: "continue", reason: decision.reason } : verdict,
            now,
          )
          const current = yield* get(sessionID)
          if (!current || current.id !== base.id || current.updated !== base.updated || current.status !== "active")
            return undefined
          yield* set(sessionID, next)
          yield* guards.record({
            sessionID,
            guard: "goal",
            action: decision.action === "continue" ? "correct" : decision.action === "wait" ? "warn" : "stop",
            subject: failed ? "gate" : (verdict?.verdict ?? "unreadable"),
            detail: `${decision.action}: ${decision.reason}`.slice(0, 500),
          })
          const text =
            decision.action === "continue"
              ? SessionGoal.continuation(next, failed ? { gate: failed } : { reason: decision.reason })
              : undefined
          return { action: decision.action, ...(text ? { text } : {}), goal: next }
        })
        const first = yield* record(goal)
        if (first) return first
        // Lost the race. A goal that is no longer active moved on without us; an active one gets
        // the decision again on the fresh record, where a raised budget may turn a stop back into
        // a continue. Losing twice used to end the turn with nothing written and the goal still
        // active on an idle session; now it is paused with a reason that says so.
        const fresh = yield* get(sessionID)
        if (!fresh || fresh.id !== goal.id || fresh.status !== "active") return undefined
        yield* Effect.logWarning("goal record changed during judgement; deciding again on the fresh record", {
          "session.id": sessionID,
        })
        const second = yield* record(fresh)
        if (second) return second
        yield* Effect.logWarning("goal record changed twice during judgement; pausing the goal", {
          "session.id": sessionID,
        })
        const paused = yield* pause(sessionID, "the goal record changed while the turn was being judged; nothing was recorded")
        if (!paused) return undefined
        return { action: "pause" as const, goal: paused }
      }).pipe(Effect.withSpan("GoalRuntime.afterTurn"))

    return Service.of({ get, set, claim, pause, block, beginTurn, afterTurn })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, Agent.node, Provider.node, LLM.node, Config.node, SessionGuardLog.node, BackgroundJob.node],
})

export * as GoalRuntime from "./goal-runtime"
