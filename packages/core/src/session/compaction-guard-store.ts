/**
 * Durable state of the v2 compaction guard, kept in the session's metadata under the same key as
 * legacy, so a restarted runtime does not start the cycle over.
 *
 * The shapes overlap but are not identical: both write `ineffective` and `paused: { after, at }`,
 * where `after` is the user request the pause holds until. Legacy also writes `turn` (the turn a run
 * of ineffective compactions belongs to, since a goal continuation is a new turn of the same
 * request); v2 writes `request` instead, because its guard counts per request and resets per run in
 * memory. Each side ignores the other's extra field, and a pause written by either holds in both.
 */
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database"
import type { GuardSnapshot, GuardStore } from "./compaction"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

const KEY = "compaction"

type Stored = {
  readonly ineffective?: unknown
  readonly request?: unknown
  readonly paused?: { readonly after?: unknown; readonly at?: unknown }
}

export const fromMetadata = (metadata: Record<string, unknown> | null | undefined): GuardSnapshot | undefined => {
  const raw = metadata?.[KEY]
  if (!raw || typeof raw !== "object") return
  const value = raw as Stored
  const ineffective = typeof value.ineffective === "number" && value.ineffective > 0 ? value.ineffective : 0
  const paused = typeof value.paused?.after === "string" ? value.paused.after : undefined
  if (ineffective === 0 && paused === undefined) return
  return {
    ineffective,
    ...(typeof value.request === "string" ? { request: value.request } : paused ? { request: paused || undefined } : {}),
    ...(paused === undefined ? {} : { paused }),
  }
}

export const make = (db: Database.Interface["db"]): GuardStore => ({
  get: (sessionID: SessionSchema.ID) =>
    db
      .select({ metadata: SessionTable.metadata })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(
        Effect.map((row) => fromMetadata(row?.metadata)),
        Effect.orDie,
      ),
  set: (sessionID: SessionSchema.ID, snapshot: GuardSnapshot | undefined) =>
    db
      .update(SessionTable)
      .set({
        // Only this key changes: the rest of the metadata belongs to other features.
        metadata:
          snapshot === undefined
            ? sql`json_remove(coalesce(${SessionTable.metadata}, '{}'), ${`$.${KEY}`})`
            : sql`json_set(coalesce(${SessionTable.metadata}, '{}'), ${`$.${KEY}`}, json(${JSON.stringify({
                ineffective: snapshot.ineffective,
                ...(snapshot.request === undefined ? {} : { request: snapshot.request }),
                ...(snapshot.paused === undefined ? {} : { paused: { after: snapshot.paused, at: Date.now() } }),
              })}))`,
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.asVoid, Effect.orDie),
})

export * as CompactionGuardStore from "./compaction-guard-store"
