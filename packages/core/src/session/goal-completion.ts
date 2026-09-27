export * as SessionGoalCompletion from "./goal-completion.js"

import { Monitor } from "@opencode/schema/monitor"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { DesignRounds } from "../design/rounds.js"
import { DesignStore } from "../design/store.js"
import { FileAccess } from "../file-access.js"
import { Intelligence } from "../intelligence.js"
import { IntelligenceEvaluation } from "../intelligence/evaluation.js"
import { MonitorRuntime } from "../monitor.js"
import { SessionEvidence } from "../tool/session-evidence.js"
import type { Tool } from "../tool.js"
import { SessionGoal } from "./goal.js"
import { SessionSchema } from "./schema.js"
import { SessionInboxTable } from "./sql.js"
import { SessionTodo } from "./todo.js"
import { SessionTodoStore } from "./todo-store.js"

interface Candidate {
  goal: SessionGoal.Info
  context: Tool.Context
  evidence: ReadonlyArray<SessionGoal.Evidence>
  checks: SessionGoal.Info["checks"]
}

const make = Effect.gen(function* () {
  const goals = yield* SessionGoal.Service
  const todos = yield* SessionTodoStore.Service
  const monitors = yield* MonitorRuntime.Service
  const access = yield* FileAccess.Service
  const intelligence = yield* Intelligence.Service
  const designs = yield* DesignStore.Service
  const db = (yield* Database.Service).db
  const candidates = new Map<SessionSchema.ID, Candidate>()

  const check = Effect.fn("SessionGoalCompletion.check")(function* (sessionID: SessionSchema.ID) {
    if (SessionTodo.active(yield* todos.review(sessionID)).length)
      return yield* new SessionGoal.Error({ message: "Resolve unfinished tasks before completing the goal" })
    if ((yield* monitors.list(sessionID)).some(Monitor.parks))
      return yield* new SessionGoal.Error({ message: "A monitor is still waiting for work to finish" })
    const goal = yield* goals.get(sessionID)
    if (goal?.stopAfter === "design") {
      const documents = yield* designs.list(sessionID)
      const approved = documents.filter((document) => document.approvedRevision && !DesignRounds.blocking(document))
      const reviewed = yield* Effect.forEach(approved, (document) =>
        Effect.gen(function* () {
          const record = yield* designs.approval(sessionID, document.id)
          // An older approval cannot finish a newly started Design goal.
          if (record.approvedAt === null || record.approvedAt < goal.created) return false
          const jobs = yield* designs.jobs(sessionID, document.id)
          return jobs.some(
            (job) =>
              job.input.revision === record.revision.id &&
              job.input.format === "audit" &&
              job.status === "completed" &&
              job.audit !== undefined &&
              record.audits.some((audit) => audit.id === job.id),
          )
        }),
      )
      if (!reviewed.some(Boolean))
        return yield* new SessionGoal.Error({
          message: "Approve and audit a Design revision for this goal before completing it",
        })
    }
  })

  const propose = Effect.fn("SessionGoalCompletion.propose")(function* (input: Candidate) {
    yield* intelligence.read().pipe(Effect.flatMap(IntelligenceEvaluation.requireConfigured))
    const current = yield* goals.get(input.goal.sessionID)
    if (!current || current.id !== input.goal.id || current.revision !== input.goal.revision || current.status !== "active")
      return yield* new SessionGoal.Error({ message: "Goal changed during verification; inspect it again" })
    const steer = yield* db
      .select({ id: SessionInboxTable.id })
      .from(SessionInboxTable)
      .where(
        and(
          eq(SessionInboxTable.session_id, input.goal.sessionID),
          eq(SessionInboxTable.delivery, "steer"),
        ),
      )
      .get()
      .pipe(Effect.orDie)
    if (steer) return yield* new SessionGoal.Error({ message: "New steering is pending; address it first" })
    candidates.set(input.goal.sessionID, {
      ...input,
      evidence: input.evidence.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
    })
    return { ...current, reason: "Verification passed; waiting for all tool effects to settle" }
  })

  const discard = (sessionID: SessionSchema.ID) => Effect.sync(() => candidates.delete(sessionID))

  const settle = Effect.fn("SessionGoalCompletion.settle")(function* (sessionID: SessionSchema.ID) {
    const candidate = candidates.get(sessionID)
    if (!candidate) return null
    candidates.delete(sessionID)
    yield* check(sessionID)
    const evidence = yield* Effect.forEach(candidate.evidence, (item) =>
      SessionEvidence.read(item.path, candidate.context, access),
    )
    if (evidence.some((item, index) => item.hash !== candidate.evidence[index]?.hash))
      return yield* new SessionGoal.Error({ message: "Evidence changed before tool effects settled" })
    yield* check(sessionID)
    const settings = yield* intelligence.read()
    yield* IntelligenceEvaluation.requireConfigured(settings)
    return yield* goals.save(candidate.goal, {
      ...candidate.goal,
      status: "done",
      reason:
        IntelligenceEvaluation.mode(settings) === "single"
          ? `Executed checks and recorded evidence passed; criteria ${IntelligenceEvaluation.UNVERIFIED}`
          : "Every criterion verified against recorded evidence after tool effects settled",
      evidence: evidence.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
      checks: candidate.checks,
    })
  })

  return { check, propose, discard, settle }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/SessionGoalCompletion",
) {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionGoal.node, SessionTodoStore.node, MonitorRuntime.node, FileAccess.node, Intelligence.node, DesignStore.node, Database.node],
})
