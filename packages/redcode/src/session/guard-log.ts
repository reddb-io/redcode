import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionGuardTripTable } from "@reddb-io/redcode-core/session/sql"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Context, DateTime, Effect, Layer } from "effect"
import { desc, gte } from "drizzle-orm"
import { ulid } from "ulid"
import type { SessionID } from "./schema"

/**
 * The record of every time a guard intervened.
 *
 * We shipped five guards — the inactivity watchdog, tool deadlines, the loop guard, the step
 * budget, the bounds on the calls around a turn — and every threshold in them was chosen by
 * argument. Without a record of when they fire, and on what, the next threshold is another
 * argument. This is what turns them into a measurement.
 *
 * Writing must never be able to break a turn: a guard that cannot be recorded still acts.
 */
export type Guard = "stall" | "tool_timeout" | "loop" | "steps" | "aux"
export type Action = "warn" | "correct" | "stop"

export interface Trip {
  readonly sessionID: SessionID
  readonly guard: Guard
  readonly action: Action
  /** The tool, phase or call it acted on. */
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

export interface Interface {
  readonly record: (trip: Trip) => Effect.Effect<void>
  /** Most recent first. */
  readonly recent: (input?: { since?: number; limit?: number }) => Effect.Effect<Entry[]>
  readonly summary: (input?: { since?: number }) => Effect.Effect<Summary[]>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionGuardLog") {}

export function summarize(entries: readonly Pick<Entry, "guard" | "action">[]): Summary[] {
  const counts = new Map<string, Summary>()
  for (const entry of entries) {
    const key = `${entry.guard}:${entry.action}`
    const found = counts.get(key)
    if (found) counts.set(key, { ...found, count: found.count + 1 })
    else counts.set(key, { guard: entry.guard, action: entry.action, count: 1 })
  }
  // Loudest first: what fires most is what most needs its threshold questioned.
  return [...counts.values()].sort((a, b) => b.count - a.count || a.guard.localeCompare(b.guard))
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service

    const record = Effect.fn("SessionGuardLog.record")(function* (trip: Trip) {
      const at = Date.now()
      yield* db
        .insert(SessionGuardTripTable)
        .values({
          id: ulid(),
          session_id: trip.sessionID,
          guard: trip.guard,
          action: trip.action,
          subject: trip.subject ?? null,
          detail: trip.detail,
          time_created: at,
          time_updated: at,
        })
        .run()
        // Losing the record of an intervention is a worse outcome than the turn failing over it,
        // but only just: the intervention itself has already happened either way.
        .pipe(Effect.catchCause((cause) => Effect.logWarning("could not record a guard trip", { cause })))
      yield* events
        .publish(SessionEvent.Guard.Tripped, {
          timestamp: yield* DateTime.now,
          sessionID: trip.sessionID,
          guard: trip.guard,
          action: trip.action,
          ...(trip.subject ? { subject: trip.subject } : {}),
          detail: trip.detail,
        })
        .pipe(Effect.ignore)
    })

    const rows = (input?: { since?: number; limit?: number }) =>
      Effect.gen(function* () {
        const base = db.select().from(SessionGuardTripTable)
        const filtered = input?.since ? base.where(gte(SessionGuardTripTable.time_created, input.since)) : base
        const ordered = filtered.orderBy(desc(SessionGuardTripTable.time_created))
        return yield* (input?.limit ? ordered.limit(input.limit) : ordered).all().pipe(Effect.orDie)
      })

    const recent = Effect.fn("SessionGuardLog.recent")(function* (input?: { since?: number; limit?: number }) {
      const found = yield* rows(input)
      return found.map(
        (row): Entry => ({
          id: row.id,
          sessionID: row.session_id,
          guard: row.guard as Guard,
          action: row.action as Action,
          ...(row.subject ? { subject: row.subject } : {}),
          detail: row.detail,
          at: row.time_created,
        }),
      )
    })

    const summary = Effect.fn("SessionGuardLog.summary")(function* (input?: { since?: number }) {
      const found = yield* rows({ since: input?.since })
      return summarize(found.map((row) => ({ guard: row.guard as Guard, action: row.action as Action })))
    })

    return Service.of({ record, recent, summary })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node, EventV2Bridge.node] })

export * as SessionGuardLog from "./guard-log"
