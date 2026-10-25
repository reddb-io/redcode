export * as SessionTaskContext from "./task-context.js"

import type { TaskContext } from "@opencode/schema/task-context"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { SessionGoalTable } from "./redcode.sql.js"
import { SessionSchema } from "./schema.js"
import { SessionTaskFacts } from "./task-facts.js"
import { SessionStore } from "./store.js"

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const store = yield* SessionStore.Service
  const get = Effect.fn("SessionTaskContext.get")(function* (sessionID: SessionSchema.ID) {
    // Observe persisted goal data directly: inspecting a graph must not resume or pause a goal.
    const row = yield* database.db
      .select()
      .from(SessionGoalTable)
      .where(eq(SessionGoalTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) {
      const session = yield* store.get(sessionID)
      const brief = SubagentReview.read(session?.metadata)
      return session?.parentID === brief?.parentSessionID ? brief?.task?.context : undefined
    }
    const goal = {
      id: row.data.id,
      objective: row.data.objective,
      criteria: row.data.criteria,
      gates: row.data.gates,
      stopAfter: row.data.stopAfter,
      executePlan: row.data.executePlan,
    }
    return { version: SessionTaskFacts.hash(goal), goal } satisfies TaskContext.Info
  })
  return { get }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTaskContext") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionStore.node],
})
