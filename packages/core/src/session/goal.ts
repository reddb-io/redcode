export * as SessionGoal from "./goal.js"
export { Input, Info, Control, Evidence, Error } from "@opencode/schema/session-goal"

import { SessionGoal } from "@opencode/schema/session-goal"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { and, eq, notExists, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { SessionSchema } from "./schema.js"
import { SessionGuardLog } from "./guard-log.js"
import { SessionGoalTable, SessionGoalReviewTable } from "./redcode.sql.js"
import { SessionInboxTable } from "./sql.js"

const owner = crypto.randomUUID()
const live = (goal: SessionGoal.Info) => goal.status === "active" || goal.status === "waiting"

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const guards = yield* SessionGuardLog.Service
  const db = database.db

  // Compare-and-swap makes a delayed review unable to undo pause, replacement or budget changes.
  const save = Effect.fn("SessionGoal.save")(function* (previous: SessionGoal.Info, next: SessionGoal.Info) {
    const data = { ...next, revision: previous.revision + 1, updated: Date.now() }
    const rows = yield* db
      .update(SessionGoalTable)
      .set({
        data:
          previous.id !== data.id
            ? data
            : sql`json_set(${JSON.stringify(data)},
                '$.tokens', json_extract(${SessionGoalTable.data}, '$.tokens') + ${next.tokens - previous.tokens},
                '$.reviews', json_extract(${SessionGoalTable.data}, '$.reviews') + ${next.reviews - previous.reviews})`,
        goal_id: data.id,
        revision: data.revision,
        owner,
      })
      .where(
        and(
          eq(SessionGoalTable.session_id, previous.sessionID),
          eq(SessionGoalTable.goal_id, previous.id),
          eq(SessionGoalTable.revision, previous.revision),
          // A pending V2 steer takes priority over autonomous completion.
          next.status === "done" && previous.status !== "done"
            ? notExists(
                db
                  .select({ id: SessionInboxTable.id })
                  .from(SessionInboxTable)
                  .where(
                    and(
                      eq(SessionInboxTable.session_id, previous.sessionID),
                      eq(SessionInboxTable.delivery, "steer"),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .returning()
      .all()
      .pipe(Effect.orDie)
    if (!rows.length)
      return yield* new SessionGoal.Error({
        message: "Goal changed or new steering was admitted while work was running; inspect it again",
      })
    return rows[0].data
  })

  const recordReview = Effect.fn("SessionGoal.recordReview")(function* (
    goal: SessionGoal.Info,
    input: { id: string; tokens: number },
  ) {
    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const inserted = yield* tx
            .insert(SessionGoalReviewTable)
            .values({
              id: input.id,
              session_id: goal.sessionID,
              goal_id: goal.id,
              tokens: Math.max(0, input.tokens),
              created: Date.now(),
            })
            .onConflictDoNothing()
            .returning()
            .all()
          if (!inserted.length) return
          // Accounting neither changes the control revision nor restores stale status/evidence.
          yield* tx
            .update(SessionGoalTable)
            .set({
              data: sql`json_set(${SessionGoalTable.data},
          '$.tokens', json_extract(${SessionGoalTable.data}, '$.tokens') + ${Math.max(0, input.tokens)},
          '$.reviews', json_extract(${SessionGoalTable.data}, '$.reviews') + 1)`,
            })
            .where(and(eq(SessionGoalTable.session_id, goal.sessionID), eq(SessionGoalTable.goal_id, goal.id)))
            .run()
        }),
      )
      .pipe(Effect.orDie, Effect.uninterruptible)
  })

  const recordUsage = Effect.fn("SessionGoal.recordUsage")(function* (
    sessionID: SessionSchema.ID,
    goalID: string,
    tokens: number,
  ) {
    if (tokens <= 0) return
    yield* db
      .update(SessionGoalTable)
      .set({
        data: sql`json_set(${SessionGoalTable.data}, '$.tokens', json_extract(${SessionGoalTable.data}, '$.tokens') + ${tokens})`,
      })
      .where(and(eq(SessionGoalTable.session_id, sessionID), eq(SessionGoalTable.goal_id, goalID)))
      .run()
      .pipe(Effect.orDie, Effect.uninterruptible)
  })

  const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionSchema.ID) {
    const row = yield* db
      .select()
      .from(SessionGoalTable)
      .where(eq(SessionGoalTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return null
    if (row.owner === owner || !live(row.data)) return row.data
    return yield* save(row.data, {
      ...row.data,
      status: "paused",
      reason: "Execution stopped in another process. Resume explicitly to continue.",
    })
  })

  const start = Effect.fn("SessionGoal.start")(function* (sessionID: SessionSchema.ID, input: SessionGoal.Input) {
    const previous = yield* get(sessionID)
    if (previous && live(previous))
      return yield* new SessionGoal.Error({ message: "Pause the current goal before replacing it" })
    const clauses = input.objective
      .split(
        /\n|;(?=\s*(?:verify|verification|outcome|done when|success|constraints?|boundaries|boundary|scope|stop[\s_-]?when|stop|escalate|gates?)\s*:)/i,
      )
      .map((line) => line.trim())
      .filter(Boolean)
    const objective = clauses.filter((line) => !/^gates?\s*:/i.test(line)).join("\n")
    const gates =
      input.gates ??
      clauses
        .filter((line) => /^gates?\s*:/i.test(line))
        .map((line) => line.replace(/^gates?\s*:/i, "").trim())
        .filter(Boolean)
    const now = Date.now()
    const data: SessionGoal.Info = {
      id: `goal_${crypto.randomUUID()}`,
      sessionID,
      revision: (previous?.revision ?? 0) + 1,
      objective,
      criteria: input.criteria?.length ? input.criteria : [objective],
      gates,
      stopAfter:
        input.stopAfter ??
        (input.executePlan ? "build" : input.agent === "plan" ? "plan" : input.agent === "design" ? "design" : "build"),
      executePlan: input.executePlan ?? false,
      status: "active",
      reason: "Starting",
      turns: { used: 0, max: input.maxTurns ?? 50 },
      tokens: 0,
      reviews: 0,
      evidence: [],
      checks: [],
      created: now,
      updated: now,
    }
    if (!data.objective) return yield* new SessionGoal.Error({ message: "Goal objective must not be empty" })
    if (previous) return yield* save(previous, data)
    const rows = yield* db
      .insert(SessionGoalTable)
      .values({ session_id: sessionID, goal_id: data.id, revision: data.revision, owner, data })
      .onConflictDoNothing()
      .returning()
      .all()
      .pipe(Effect.orDie)
    if (!rows.length)
      return yield* new SessionGoal.Error({ message: "Another goal was created concurrently; inspect it again" })
    return data
  })

  const control = Effect.fn("SessionGoal.control")(function* (sessionID: SessionSchema.ID, input: SessionGoal.Control) {
    const goal = yield* get(sessionID)
    if (!goal) return null
    if (input.action === "drop") {
      yield* db
        .delete(SessionGoalTable)
        .where(
          and(
            eq(SessionGoalTable.session_id, sessionID),
            eq(SessionGoalTable.goal_id, goal.id),
            eq(SessionGoalTable.revision, goal.revision),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      return null
    }
    if (input.action === "budget") {
      if (!input.maxTurns)
        return yield* new SessionGoal.Error({ message: "A positive step budget is required" })
      return yield* save(goal, { ...goal, turns: { ...goal.turns, max: input.maxTurns } })
    }
    if (input.action === "resume" && goal.turns.used >= goal.turns.max)
      return yield* new SessionGoal.Error({
        message: "Step budget exhausted. Increase the budget before resuming.",
      })
    if (goal.status === "done") return goal
    return yield* save(goal, {
      ...goal,
      status: input.action === "pause" ? "paused" : "active",
      reason: input.action === "pause" ? "Paused by user" : "Resumed by user",
    })
  })

  const beginStep = Effect.fn("SessionGoal.beginStep")(function* (sessionID: SessionSchema.ID) {
    const goal = yield* get(sessionID)
    if (!goal || !live(goal)) return undefined
    if (goal.turns.used >= goal.turns.max) {
      const reason = `Used ${goal.turns.max} steps. Budget exhaustion is not completion.`
      yield* save(goal, {
        ...goal,
        status: "paused",
        reason,
      })
      yield* guards.record({
        sessionID,
        guard: "budget",
        action: "stop",
        subject: "goal",
        detail: reason,
      })
      return false
    }
    yield* save(goal, {
      ...goal,
      status: "active",
      reason: "Working",
      turns: { ...goal.turns, used: goal.turns.used + 1 },
    })
    return goal.id
  })

  const settle = Effect.fn("SessionGoal.settle")(function* (
    sessionID: SessionSchema.ID,
    input: { goalID: string; tokens: number; waiting?: boolean; failed?: boolean; interrupted?: boolean },
  ) {
    const goal = yield* get(sessionID)
    if (!goal || goal.id !== input.goalID) return false
    if (!live(goal)) {
      if (input.tokens > 0) yield* save(goal, { ...goal, tokens: goal.tokens + input.tokens })
      return false
    }
    yield* save(goal, {
      ...goal,
      tokens: goal.tokens + Math.max(0, input.tokens),
      status: input.interrupted ? "paused" : input.failed ? "blocked" : input.waiting ? "waiting" : "active",
      reason: input.interrupted
        ? "Execution interrupted. Resume explicitly to continue."
        : input.failed
          ? "Provider failed. Inspect the error and resume explicitly."
          : input.waiting
            ? "Waiting for Design jobs; resume after they finish"
            : "Verifying progress",
    })
    return !input.failed && !input.waiting && !input.interrupted
  })

  return { get, start, control, save, beginStep, settle, recordReview, recordUsage }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionGoal") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionGuardLog.node],
})

export function guidance(goal: SessionGoal.Info | null) {
  if (!goal) return ""
  return [
    `Goal ${goal.id}: ${goal.objective}`,
    `Status: ${goal.status}. ${goal.reason}`,
    `Scope ends after ${goal.stopAfter}. Plan execution pre-authorized: ${goal.executePlan}. This does not authorize work outside the objective.`,
    `Steps: ${goal.turns.used}/${goal.turns.max}. Budget exhaustion is not completion.`,
    ...goal.criteria.map((criterion, index) => `Criterion ${index + 1}: ${criterion}`),
    "When complete, call goal_complete with actual evidence file paths and a concise explanation of how every criterion is met. The harness reads and hashes the files, runs configured checks and reviews the evidence. Do not claim success without passing verification.",
    "Continue within the authorized scope. Keep progress concise: current checkpoint, verified facts, remaining work and blockers. Use goal_status to report a real blocker or pause; never redefine the objective to make it easier.",
  ].join("\n")
}
