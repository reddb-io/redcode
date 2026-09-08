export * as SessionPlan from "./plan"
export { Info, Error } from "@reddb-io/redcode-schema/session-plan"

import { SessionPlan } from "@reddb-io/redcode-schema/session-plan"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Semaphore } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionPlanTable } from "./goal.sql"

const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const lock = yield* Semaphore.make(1)
  const list = Effect.fn("SessionPlan.list")(function* (sessionID: SessionSchema.ID) {
    return (yield* database.db
      .select()
      .from(SessionPlanTable)
      .where(eq(SessionPlanTable.session_id, sessionID))
      .orderBy(desc(SessionPlanTable.created))
      .all()
      .pipe(Effect.orDie)).map((row) => row.data)
  })
  const record = Effect.fn("SessionPlan.record")(function* (input: SessionPlan.Info) {
    if (!input.content.trim()) return yield* new SessionPlan.Error({ message: "The plan is empty" })
    const existing = (yield* list(input.sessionID)).find((plan) => plan.revision === input.revision)
    if (existing?.status === "approved" || existing?.status === input.status) return existing
    if (existing) {
      yield* database.db
        .update(SessionPlanTable)
        .set({ data: input, created: input.created })
        .where(and(eq(SessionPlanTable.session_id, input.sessionID), eq(SessionPlanTable.revision, input.revision)))
        .run()
        .pipe(Effect.orDie)
      return input
    }
    yield* database.db
      .insert(SessionPlanTable)
      .values({ session_id: input.sessionID, revision: input.revision, created: input.created, data: input })
      .run()
      .pipe(Effect.orDie)
    return input
  }, lock.withPermits(1))
  return { list, record }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionPlan") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })

export function guidance(plans: ReadonlyArray<SessionPlan.Info>) {
  const plan = plans.find((plan) => plan.status === "approved") ?? plans[0]
  if (!plan) return ""
  return `Plan ${plan.revision} (${plan.status}), source ${plan.path}. Use this recorded content, not a later unapproved draft.${plans[0]?.revision !== plan.revision ? ` A newer draft ${plans[0].revision} exists and has not been approved.` : ""}\n${plan.content}`
}
