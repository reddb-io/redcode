export * as SessionGoalCompletion from "./goal-completion"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Database } from "../database/database"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { DesignStore } from "../design/store"
import { DesignRenderer } from "../design/renderer"
import { SessionEvidence } from "../tool/session-evidence"
import type { Tool } from "../tool/tool"
import { SessionGoal } from "./goal"
import { SessionSchema } from "./schema"
import { SessionTodo } from "./todo"
import { SessionInput } from "./input"

type Candidate = {
  goal: SessionGoal.Info
  context: Tool.Context
  evidence: ReadonlyArray<SessionGoal.Evidence>
  checks: SessionGoal.Info["checks"]
}

const make = Effect.gen(function* () {
  const goals = yield* SessionGoal.Service
  const database = yield* Database.Service
  const todos = yield* SessionTodo.Service
  const designs = yield* DesignStore.Service
  const renderer = yield* DesignRenderer.Service
  const permissions = yield* PermissionV2.Service
  const location = yield* Location.Service
  const candidates = new Map<SessionSchema.ID, Candidate>()

  const check = Effect.fn("SessionGoalCompletion.check")(function* (sessionID: SessionSchema.ID) {
    if (SessionTodo.active(yield* todos.get(sessionID)).length)
      return yield* new ToolFailure({ message: "Resolve unfinished todos before completing the goal" })
    yield* Effect.forEach(yield* designs.list(sessionID), (design) =>
      Effect.gen(function* () {
        if ((yield* renderer.jobs(design.id)).some((job) => job.status === "running" || job.status === "queued"))
          return yield* new ToolFailure({ message: "Design jobs are still pending. Wait for their results." })
      }),
    )
  })

  const propose = Effect.fn("SessionGoalCompletion.propose")(function* (input: Candidate) {
    const current = yield* goals.get(input.goal.sessionID)
    if (
      !current ||
      current.id !== input.goal.id ||
      current.revision !== input.goal.revision ||
      current.status !== "active"
    )
      return yield* new ToolFailure({ message: "Goal changed during verification; inspect it again" })
    if (yield* SessionInput.hasPending(database.db, input.goal.sessionID, "steer"))
      return yield* new ToolFailure({ message: "New steering is pending; address it before completing the goal" })
    candidates.set(input.goal.sessionID, {
      ...input,
      evidence: input.evidence.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
    })
    return { ...current, reason: "Verification passed; waiting for the runner to settle all tool effects" }
  })

  const discard = (sessionID: SessionSchema.ID) => Effect.sync(() => candidates.delete(sessionID))

  const settle = Effect.fn("SessionGoalCompletion.settle")(function* (sessionID: SessionSchema.ID) {
    const candidate = candidates.get(sessionID)
    if (!candidate) return null
    candidates.delete(sessionID)
    yield* check(sessionID)
    const evidence = yield* Effect.forEach(candidate.evidence, (item) =>
      SessionEvidence.read(item.path, candidate.context, permissions, location),
    )
    if (evidence.some((item, index) => item.hash !== candidate.evidence[index].hash))
      return yield* new ToolFailure({
        message: "Evidence changed before the turn settled. Verify the current files again.",
      })
    yield* check(sessionID)
    return yield* goals.save(candidate.goal, {
      ...candidate.goal,
      status: "done",
      reason: "Every criterion verified against recorded evidence after tool effects settled",
      evidence: evidence.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
      checks: candidate.checks,
    })
  })

  return { check, propose, settle, discard }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/SessionGoalCompletion",
) {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionGoal.node,
    SessionTodo.node,
    DesignStore.node,
    DesignRenderer.node,
    PermissionV2.node,
    Location.node,
    Database.node,
  ],
})
