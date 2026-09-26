export * as SessionGuardLog from "./guard-log.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { desc, gte } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { SessionSchema } from "./schema.js"
import { SessionGuardTripTable } from "./redcode.sql.js"

export type Guard =
  | "stall"
  | "tool_timeout"
  | "loop"
  | "steps"
  | "aux"
  | "orphan"
  | "goal"
  | "compaction"
  | "budget"
  | "intelligence"
  | "stop_loss"
export type Action = "warn" | "correct" | "stop"

export interface Trip {
  readonly sessionID: SessionSchema.ID
  readonly guard: Guard
  readonly action: Action
  readonly subject?: string
  readonly detail: string
}

export interface Entry extends Trip {
  readonly id: string
  readonly at: number
}

export interface Summary {
  readonly guard: Guard
  readonly action: Action
  readonly count: number
}

const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db

  const record = Effect.fn("SessionGuardLog.record")(function* (trip: Trip) {
    const at = Date.now()
    yield* db
      .insert(SessionGuardTripTable)
      .values({
        id: crypto.randomUUID(),
        session_id: trip.sessionID,
        guard: trip.guard,
        action: trip.action,
        subject: trip.subject ?? null,
        detail: trip.detail,
        time_created: at,
        time_updated: at,
      })
      .run()
      .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not record guard intervention", { cause })))
  })

  const recent = Effect.fn("SessionGuardLog.recent")(function* (input?: { since?: number; limit?: number }) {
    const rows = yield* db
      .select()
      .from(SessionGuardTripTable)
      .where(input?.since === undefined ? undefined : gte(SessionGuardTripTable.time_created, input.since))
      .orderBy(desc(SessionGuardTripTable.time_created))
      .limit(input?.limit ?? 100)
      .all()
      .pipe(Effect.orDie)
    return rows.map(
      (row): Entry => ({
        id: row.id,
        sessionID: SessionSchema.ID.make(row.session_id),
        guard: row.guard as Guard,
        action: row.action as Action,
        ...(row.subject ? { subject: row.subject } : {}),
        detail: row.detail,
        at: row.time_created,
      }),
    )
  })

  const summary = Effect.fn("SessionGuardLog.summary")(function* (input?: { since?: number }) {
    const rows = yield* db
      .select({ guard: SessionGuardTripTable.guard, action: SessionGuardTripTable.action })
      .from(SessionGuardTripTable)
      .where(input?.since === undefined ? undefined : gte(SessionGuardTripTable.time_created, input.since))
      .all()
      .pipe(Effect.orDie)
    const counts = rows.reduce((result, row) => {
      const key = `${row.guard}:${row.action}`
      const current = result.get(key)
      result.set(key, {
        guard: row.guard as Guard,
        action: row.action as Action,
        count: (current?.count ?? 0) + 1,
      })
      return result
    }, new Map<string, Summary>())
    return [...counts.values()].sort((a, b) => b.count - a.count || a.guard.localeCompare(b.guard))
  })

  return { record, recent, summary }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@opencode/SessionGuardLog") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })
