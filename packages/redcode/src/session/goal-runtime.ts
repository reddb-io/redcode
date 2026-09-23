import { Context, Duration, Effect, Layer } from "effect"
import { Stream } from "effect"
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
import { SessionBudget } from "./budget"
import { SessionSpend } from "./spend"
import { Process } from "@/util/process"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionInput } from "@reddb-io/redcode-core/session/input"

/**
 * The goal loop's impure half: where the goal is kept, how the judge is asked, how gates run.
 *
 * The decisions themselves are in `goal.ts` and take values; this file only fetches those
 * values and writes the results back. An unavailable evaluator cannot approve completion.
 * Unanswered checks follow the bounded judge-failure policy; failed gates preserve their
 * output and keep the goal unfinished.
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
  /**
   * Before a provider step: undefined to go ahead, or the transcript notice when a spend budget —
   * the session's, a parent's, or this goal's — refuses it. Pauses an active goal and tells
   * whoever is watching. Spends nothing.
   */
  readonly admit: (input: SessionSpend.AdmitInput) => Effect.Effect<string | undefined>
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
    const database = yield* Database.Service
    const intelligence = yield* Intelligence.Service
    const config = yield* Config.Service
    const guards = yield* SessionGuardLog.Service
    const jobs = yield* BackgroundJob.Service
    const spend = yield* SessionSpend.Service

    const get = Effect.fn("GoalRuntime.get")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
      return SessionGoal.fromMetadata(session?.metadata)
    })

    const set = Effect.fn("GoalRuntime.set")(function* (sessionID: SessionID, goal: SessionGoal.Goal | undefined) {
      // A goal's spend counts from when it was set: the session's total at that moment is its zero.
      const counted = goal && !goal.spendStart ? { ...goal, spendStart: yield* spend.totals(sessionID) } : goal
      // An active goal always names the process driving it, so a later process can tell it was
      // not the one — and pause rather than pick the loop up on its own.
      const stamped = counted && counted.status === "active" ? { ...counted, boot: SessionGoal.BOOT } : counted
      // Only the goal key, against a fresh read: spend and compaction write the same record.
      yield* sessions.updateMetadata(sessionID, (metadata) => SessionGoal.toMetadata(metadata, stamped))
    })

    /** The goal's spend against its budget; undefined when the person set none. */
    const spendStatus = Effect.fn("GoalRuntime.spendStatus")(function* (sessionID: SessionID, goal: SessionGoal.Goal) {
      if (!goal.budget) return undefined
      return SessionGoal.spendStatus(goal, yield* spend.totals(sessionID))
    })

    const goalNotice = (status: SessionBudget.Status) =>
      `Goal paused at its budget: ${status.reason}. Raise it with /goal-budget, then /goal-resume.`

    const budgetNotice = (sessionID: SessionID, status: SessionBudget.Status) =>
      spend.notify({ sessionID, action: "stop", subject: "goal", message: goalNotice(status) })

    const admit: Interface["admit"] = (input) =>
      Effect.gen(function* () {
        const refused = yield* spend.admit(input)
        if (refused) {
          yield* pause(input.sessionID, refused.reason)
          yield* spend.notify({
            sessionID: input.sessionID,
            action: "stop",
            subject: refused.sessionID === input.sessionID ? "session" : "parent",
            message: refused.message,
          })
          return refused.message
        }
        const goal = yield* get(input.sessionID)
        if (!goal || goal.status !== "active") return undefined
        const status = yield* spendStatus(input.sessionID, goal)
        if (!status?.exceeded) return undefined
        yield* set(input.sessionID, SessionGoal.paused(goal, SessionBudget.pauseReason(status), Date.now()))
        yield* budgetNotice(input.sessionID, status)
        return goalNotice(status)
      })

    // Admission only: the budget is spent in `afterTurn`, once per judged turn. This runs before
    // every provider attempt — each tool round-trip, each retry — and used to charge each one, so
    // a turn that read fifteen files spent fifteen turns of a budget that said twenty.
    const beginTurn = Effect.fn("GoalRuntime.beginTurn")(function* (sessionID: SessionID) {
      const goal = yield* get(sessionID)
      if (!goal || goal.status !== "active") return true
      if (goal.turns.used >= goal.turns.max) {
        yield* set(sessionID, SessionGoal.paused(goal, SessionGoal.budgetReason(goal), Date.now()))
        return false
      }
      // The step that crossed the spend budget has finished; the next one is not started.
      const status = yield* spendStatus(sessionID, goal)
      if (!status?.exceeded) return true
      yield* set(sessionID, SessionGoal.paused(goal, SessionBudget.pauseReason(status), Date.now()))
      yield* budgetNotice(sessionID, status)
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
            (r) => ({
              ok: r.code === 0,
              output: Intelligence.evidence(r.text + "\n" + r.stderr.toString(), { limit: GATE_OUTPUT_CHARS }).content,
            }),
            (error: unknown) => ({ ok: false, output: error instanceof Error ? error.message : String(error) }),
          ),
        )
        out.push({ command, ...result })
        if (!result.ok) break
      }
      return out
    })

    /** S2 proposes the bounded goal decision; S1 must separately approve a proposed completion. */
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
      const content = [
        "<goal>",
        `Objective: ${input.goal.objective}`,
        ...(input.goal.contract.outcome ? [`Outcome: ${input.goal.contract.outcome}`] : []),
        ...(input.goal.contract.verification ? [`Verification: ${input.goal.contract.verification}`] : []),
        ...(input.goal.contract.constraints ? [`Constraints: ${input.goal.contract.constraints}`] : []),
        ...(input.goal.contract.boundaries ? [`Boundaries: ${input.goal.contract.boundaries}`] : []),
        ...(input.goal.contract.stop_when ? [`Stop when: ${input.goal.contract.stop_when}`] : []),
        ...(input.goal.gates.length ? [`Gates (all passed this turn): ${input.goal.gates.join(" && ")}`] : []),
        `Turn ${input.goal.turns.used + 1} of ${input.goal.turns.max}.`,
        "</goal>",
        "",
        input.goal.claimed
          ? `<claim>\nThe agent called goal_complete with this evidence:\n${input.goal.claimed.evidence}\n</claim>`
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
          // The judge weighs the evidence as written; a router must not trim it.
          router: { tokenSaver: false },
          messages: [{ role: "user", content }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
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
      const verdict = SessionGoal.parseVerdict(text)
      if (!verdict || verdict.verdict !== "done") return verdict
      const settings = yield* intelligence.read()
      yield* Intelligence.requireConfigured(settings)
      // Gates already ran before the judge; single reasoning skips only the S1 review.
      if (Intelligence.mode(settings) === "single")
        return {
          ...verdict,
          reason: [verdict.reason, `S1 review ${Intelligence.UNVERIFIED}`].filter(Boolean).join("; "),
        }
      const evaluation = yield* intelligence.evaluate({
        sessionID: input.session.id,
        operation: "goal_completion",
        subjectID: input.goal.id,
        sources: {
          objective: input.goal.objective,
          contract: input.goal.contract,
          gates: input.goal.gates,
          evidence: Intelligence.evidence(input.evidence, { reference: "executed-tools-and-gates", limit: 32000 }),
          lastAnswer: Intelligence.evidence(input.answer, { limit: 8000 }),
          background: input.background,
        },
        candidate: { verdict, claim: input.goal.claimed },
        questions: Intelligence.questions({
          unsupported:
            "Does the proposed completion lack observed evidence proving the objective and every contract requirement within its scope? A confident claim or unexecuted test file does not prove runtime behavior.",
          incomplete:
            "Does completion depend on missing or truncated evidence, failed checks or background work? Omitted evidence must never be assumed successful.",
        }),
      })
      yield* Intelligence.requireConfigured(yield* intelligence.read())
      if (!evaluation || evaluation.decision === "unavailable" || evaluation.decision === "inconclusive")
        return undefined
      return evaluation.decision === "accepted"
        ? verdict
        : { verdict: "continue" as const, reason: `System One requires correction: ${evaluation.issues.join(", ")}` }
    })

    const afterTurn = (input: AfterTurnInput): Effect.Effect<AfterTurnResult | undefined> =>
      Effect.gen(function* () {
        const goal = SessionGoal.fromMetadata(input.session.metadata)
        if (!goal || goal.status !== "active") return undefined
        const sessionID = input.session.id
        const now = Date.now()

        // Monitors are not counted here: the turn loop decides which of them hold judging back
        // (`Monitor.parks`), so a long-lived dev server does not keep a goal waiting for a day.
        const running = (yield* jobs.list()).filter(
          (job) =>
            job.status === "running" && job.type !== "monitor" && job.metadata?.["parentSessionId"] === sessionID,
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
        const evidence = [
          ...observed,
          ...gateResults.map((check) => `${check.command}: ${check.ok ? "PASS" : "FAIL"}\n${check.output}`),
        ].join("\n\n")
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
          const current = yield* get(sessionID)
          if (
            !current ||
            current.status !== "active" ||
            Intelligence.fingerprint(current) !== Intelligence.fingerprint(base)
          )
            return undefined
          if (yield* SessionInput.hasPending(database.db, sessionID, "steer"))
            return {
              action: "continue" as const,
              goal: base,
              text: SessionGoal.continuation(base, {
                reason: "Address the newly admitted user instruction before completing the goal.",
              }),
            }
          // Read after the judge: its own call is part of what the goal spent.
          const budget = yield* spendStatus(sessionID, base)
          const decision = SessionGoal.decide({
            goal: base,
            ...(verdict ? { verdict } : {}),
            gates: gateResults,
            waiting: running.length > 0,
            evidence: evidence.length > 0,
            ...(budget ? { budget } : {}),
          })
          // A failed gate is not a judge failure: the judge was never asked.
          const next = SessionGoal.apply(
            base,
            decision,
            failed ? { verdict: "continue", reason: decision.reason } : verdict,
            now,
          )
          if (next.status === "done" && !Intelligence.isReady(yield* intelligence.read().pipe(Effect.orDie))) {
            const paused = yield* pause(sessionID, "Configure S1 and S2 again before completing this goal")
            return paused ? { action: "pause" as const, goal: paused } : undefined
          }
          const counted = next.spendStart ? next : { ...next, spendStart: yield* spend.totals(sessionID) }
          const stamped = counted.status === "active" ? { ...counted, boot: SessionGoal.BOOT } : counted
          const stored = SessionGoal.fromMetadata(
            yield* sessions.updateMetadata(
              sessionID,
              (metadata) => SessionGoal.toMetadata(metadata, stamped),
              Effect.gen(function* () {
                return (
                  Intelligence.fingerprint(yield* get(sessionID)) === Intelligence.fingerprint(base) &&
                  !(yield* SessionInput.hasPending(database.db, sessionID, "steer"))
                )
              }),
            ),
          )
          if (
            !stored ||
            Intelligence.fingerprint(stored) !==
              Intelligence.fingerprint(SessionGoal.fromMetadata(SessionGoal.toMetadata({}, stamped)))
          )
            return undefined
          yield* guards.record({
            sessionID,
            guard: "goal",
            action: decision.action === "continue" ? "correct" : decision.action === "wait" ? "warn" : "stop",
            subject: failed ? "gate" : (verdict?.verdict ?? "unreadable"),
            detail: `${decision.action}: ${decision.reason}`.slice(0, 500),
          })
          if (budget?.exceeded && decision.action === "stop") yield* budgetNotice(sessionID, budget)
          const text =
            decision.action === "continue"
              ? SessionGoal.continuation(next, failed ? { gate: failed } : { reason: decision.reason })
              : undefined
          return { action: decision.action, ...(text ? { text } : {}), goal: stored }
        })
        const first = yield* record(goal)
        if (first) return first
        // Lost the race. A goal that is no longer active moved on without us; an active one gets
        // the decision again on the fresh record, where a raised budget may turn a stop back into
        // a continue. Losing twice used to end the turn with nothing written and the goal still
        // active on an idle session; now it is paused with a reason that says so.
        const fresh = yield* get(sessionID)
        if (!fresh || fresh.id !== goal.id || fresh.status !== "active") return undefined
        if (
          Intelligence.fingerprint([fresh.objective, fresh.contract, fresh.gates, fresh.claimed]) !==
          Intelligence.fingerprint([goal.objective, goal.contract, goal.gates, goal.claimed])
        )
          return {
            action: "continue" as const,
            goal: fresh,
            text: SessionGoal.continuation(fresh, {
              reason:
                "The goal or completion claim changed during review. Recheck the current requirements before completing it.",
            }),
          }
        yield* Effect.logWarning("goal record changed during judgement; deciding again on the fresh record", {
          "session.id": sessionID,
        })
        const second = yield* record(fresh)
        if (second) return second
        yield* Effect.logWarning("goal record changed twice during judgement; pausing the goal", {
          "session.id": sessionID,
        })
        const paused = yield* pause(
          sessionID,
          "the goal record changed while the turn was being judged; nothing was recorded",
        )
        if (!paused) return undefined
        return { action: "pause" as const, goal: paused }
      }).pipe(Effect.withSpan("GoalRuntime.afterTurn"))

    return Service.of({ get, set, claim, pause, block, admit, beginTurn, afterTurn })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Session.node,
    Agent.node,
    Provider.node,
    LLM.node,
    Intelligence.node,
    Database.node,
    Config.node,
    SessionGuardLog.node,
    BackgroundJob.node,
    SessionSpend.node,
  ],
})

export * as GoalRuntime from "./goal-runtime"
