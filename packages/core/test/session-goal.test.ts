import { AgentV2 } from "../src/agent"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"
import { SessionGoalTable, SessionGoalReviewTable } from "../src/session/goal.sql"
import { SessionGoal } from "../src/session/goal"
import { SessionPlan } from "../src/session/plan"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([SessionGoal.node, SessionPlan.node, Database.node])))
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const id = SessionSchema.ID.make(`ses_${crypto.randomUUID()}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({ id, project_id: Project.ID.global, directory: "/project", title: "Goal", slug: "goal", version: "test" })
    .run()
    .pipe(Effect.orDie)
  return id
})

describe("Durable Session goals and plans", () => {
  it.effect("counts the first provider turn and pauses before exceeding its budget", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const goals = yield* SessionGoal.Service
      yield* goals.start(id, { objective: "Produce the plan", agent: AgentV2.ID.make("plan"), maxTurns: 1 })
      expect((yield* goals.get(id))?.stopAfter).toBe("plan")
      expect(typeof (yield* goals.beginTurn(id))).toBe("string")
      expect(yield* goals.beginTurn(id)).toBe(false)
      expect((yield* goals.get(id))?.turns.used).toBe(1)
      expect((yield* goals.get(id))?.status).toBe("paused")
      expect((yield* goals.get(id))?.reason).toContain("not completion")
      expect((yield* goals.control(id, { action: "resume" }).pipe(Effect.exit))._tag).toBe("Failure")
      yield* goals.control(id, { action: "budget", maxTurns: 2 })
      yield* goals.control(id, { action: "resume" })
      expect(typeof (yield* goals.beginTurn(id))).toBe("string")
    }),
  )

  it.effect("rejects a delayed completion after pause or drop and replacement", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const goals = yield* SessionGoal.Service
      const first = yield* goals.start(id, { objective: "First" })
      yield* goals.control(id, { action: "pause" })
      expect((yield* goals.save(first, { ...first, status: "done" }).pipe(Effect.exit))._tag).toBe("Failure")
      expect((yield* goals.get(id))?.status).toBe("paused")
      yield* goals.control(id, { action: "drop" })
      const next = yield* goals.start(id, { objective: "Replacement" })
      expect(next.revision).toBe(first.revision)
      expect((yield* goals.save(first, { ...first, status: "done" }).pipe(Effect.exit))._tag).toBe("Failure")
      expect((yield* goals.get(id))?.objective).toBe("Replacement")
    }),
  )

  it.effect("preserves the goal across process replacement and requires explicit resume", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const database = yield* Database.Service
      const goals = yield* SessionGoal.Service
      const original = yield* goals.start(id, { objective: "Do not duplicate provider work" })
      yield* database.db
        .update(SessionGoalTable)
        .set({ owner: "previous-process" })
        .where(eq(SessionGoalTable.session_id, id))
        .run()
        .pipe(Effect.orDie)
      const recovered = yield* goals.get(id)
      expect(recovered?.id).toBe(original.id)
      expect(recovered?.status).toBe("paused")
      expect(recovered?.turns.used).toBe(0)
      expect((yield* goals.control(id, { action: "resume" }))?.status).toBe("active")
    }),
  )

  it.effect("waiting records no additional provider turns and preserves measured usage", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const goals = yield* SessionGoal.Service
      yield* goals.start(id, { objective: "Await the audit" })
      yield* goals.beginTurn(id)
      yield* goals.settle(id, { goalID: (yield* goals.get(id))!.id, tokens: 123, waiting: true })
      const waiting = yield* goals.get(id)
      expect(waiting?.status).toBe("waiting")
      expect(waiting?.turns.used).toBe(1)
      expect(waiting?.tokens).toBe(123)
    }),
  )

  it.effect("keeps final usage without changing completion or attributing it to a replacement", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const goals = yield* SessionGoal.Service
      const goal = yield* goals.start(id, {
        objective: "Write a plan; verify: review it; gate: true",
        agent: AgentV2.ID.make("plan"),
      })
      expect(goal.gates).toEqual(["true"])
      expect(goal.objective).toContain("verify: review it")
      expect(goal.objective).not.toContain("gate:")
      yield* goals.save(goal, { ...goal, status: "done" })
      expect(yield* goals.settle(id, { goalID: goal.id, tokens: 123 })).toBe(false)
      expect((yield* goals.get(id))?.tokens).toBe(123)
      expect((yield* goals.get(id))?.status).toBe("done")
      const next = yield* goals.start(id, { objective: "Next goal" })
      yield* goals.settle(id, { goalID: goal.id, tokens: 456 })
      expect((yield* goals.get(id))?.id).toBe(next.id)
      expect((yield* goals.get(id))?.tokens).toBe(0)
    }),
  )

  it.effect("review receipts are idempotent and survive stale control writes and Goal replacement", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const database = yield* Database.Service
      const goals = yield* SessionGoal.Service
      const goal = yield* goals.start(id, { objective: "First" })
      const receipt = { id: crypto.randomUUID(), tokens: 15 }
      yield* goals.recordReview(goal, receipt)
      yield* goals.recordReview(goal, receipt)
      yield* goals.save(goal, { ...goal, status: "paused" })
      expect((yield* goals.get(id))?.tokens).toBe(15)
      expect((yield* goals.get(id))?.reviews).toBe(1)
      const next = yield* goals.start(id, { objective: "Replacement" })
      yield* goals.recordReview(goal, { id: crypto.randomUUID(), tokens: 20 })
      expect((yield* goals.get(id))?.id).toBe(next.id)
      expect((yield* goals.get(id))?.tokens).toBe(0)
      const receipts = yield* database.db
        .select()
        .from(SessionGoalReviewTable)
        .where(eq(SessionGoalReviewTable.goal_id, goal.id))
        .all()
        .pipe(Effect.orDie)
      expect(receipts.map((receipt) => receipt.tokens).toSorted()).toEqual([15, 20])
    }),
  )

  it.effect("retains approved plan contents when a later draft is recorded", () =>
    Effect.gen(function* () {
      const id = yield* setup
      const plans = yield* SessionPlan.Service
      yield* plans.record({
        sessionID: id,
        revision: "one",
        path: "plan.md",
        content: "First plan",
        status: "approved",
        created: 1,
      })
      yield* plans.record({
        sessionID: id,
        revision: "two",
        path: "plan.md",
        content: "Changed draft",
        status: "ready",
        created: 2,
      })
      const versions = yield* plans.list(id)
      expect(versions.map((plan) => plan.revision)).toEqual(["two", "one"])
      expect(versions[1].content).toBe("First plan")
      expect(versions[1].status).toBe("approved")
      expect((yield* plans.record({ ...versions[1], content: "Mutated", status: "ready" })).content).toBe("First plan")
    }),
  )
})
