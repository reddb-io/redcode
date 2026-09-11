export * as SessionContextEpoch from "./context-epoch"

import { eq, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { SystemContext } from "../system-context/index"
import { ContextSnapshotDecodeError } from "./error"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable } from "./sql"

type DatabaseService = Database.Interface["db"]

interface Prepared {
  readonly baseline: string
  readonly baselineSeq: number
}

export function initialize(
  db: DatabaseService,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
): Effect.Effect<Prepared | undefined, SystemContext.InitializationBlocked> {
  return initializeOnce(db, context, sessionID).pipe(Effect.withSpan("SessionContextEpoch.initialize"))
}

export function prepare(
  db: DatabaseService,
  events: EventV2.Interface,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
): Effect.Effect<Prepared, SystemContext.InitializationBlocked | ContextSnapshotDecodeError> {
  return prepareOnce(db, events, context, sessionID).pipe(Effect.withSpan("SessionContextEpoch.prepare"))
}

const prepareOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
) {
  const [value, stored, compaction] = yield* Effect.all(
    [context, find(db, sessionID), SessionHistory.latestCompaction(db, sessionID)],
    { concurrency: "unbounded" },
  )
  if (!stored) {
    const generation = yield* SystemContext.initialize(value)
    const baselineSeq = yield* insert(db, sessionID, generation)
    return { baseline: generation.baseline, baselineSeq }
  }

  const snapshot = yield* Schema.decodeUnknownEffect(SystemContext.Snapshot)(stored.snapshot).pipe(
    Effect.mapError((error) => new ContextSnapshotDecodeError({ sessionID, details: String(error) })),
  )
  // A replacement is pending while a boundary lies after the baseline: a compaction message
  // admitted after it, or any replacement requested by a runtime whose compaction leaves no such
  // message. It stays pending, and blocks admission of ordinary updates, until every previously
  // admitted source is observable again and the generation is rendered whole.
  const requested = stored.replacement_seq ?? undefined
  const compacted = compaction !== undefined && compaction.seq > stored.baseline_seq ? compaction.seq : undefined
  const boundaries = [requested, compacted].filter((seq): seq is number => seq !== undefined)
  const replacementSeq = boundaries.length === 0 ? undefined : Math.max(...boundaries)
  const result =
    replacementSeq === undefined
      ? yield* SystemContext.reconcile(value, snapshot)
      : yield* SystemContext.replace(value, snapshot)
  if (result._tag === "Unchanged" || result._tag === "ReplacementBlocked") {
    return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
  }
  if (result._tag === "ReplacementReady") {
    const baselineSeq = replacementSeq ?? (yield* EventV2.latestSequence(db, sessionID))
    yield* replace(db, sessionID, baselineSeq, result.generation, stored.replacement_seq)
    return { baseline: result.generation.baseline, baselineSeq }
  }

  yield* events.publish(
    SessionEvent.ContextUpdated,
    { sessionID, messageID: SessionMessage.ID.create(), timestamp: yield* DateTime.now, text: result.text },
    { commit: () => advance(db, sessionID, result.snapshot).pipe(Effect.orDie) },
  )
  return { baseline: stored.baseline, baselineSeq: stored.baseline_seq }
})

const initializeOnce = Effect.fnUntraced(function* (
  db: DatabaseService,
  context: Effect.Effect<SystemContext.SystemContext>,
  sessionID: SessionSchema.ID,
) {
  if (yield* exists(db, sessionID)) return
  const generation = yield* context.pipe(Effect.flatMap(SystemContext.initialize))
  const baselineSeq = yield* insert(db, sessionID, generation)
  return { baseline: generation.baseline, baselineSeq }
})

const exists = Effect.fn("SessionContextEpoch.exists")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return (
    (yield* db
      .select({ sessionID: SessionContextEpochTable.session_id })
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)) !== undefined
  )
})

const find = Effect.fn("SessionContextEpoch.find")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionContextEpochTable)
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

/**
 * Marks the current durable sequence as a replacement boundary for the active epoch, so the next
 * preparation renders a fresh generation instead of admitting updates. Made before a compaction
 * summary is written: a crash after the summary still leaves the request durable, and a summary
 * never runs under the previous baseline unless the replacement is legitimately blocked. Without
 * an active epoch there is nothing to replace, and the next preparation initializes one.
 */
export const requestReplacement = Effect.fn("SessionContextEpoch.requestReplacement")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const replacementSeq = yield* EventV2.latestSequence(db, sessionID)
  yield* db
    .update(SessionContextEpochTable)
    .set({ replacement_seq: replacementSeq })
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const reset = Effect.fn("SessionContextEpoch.reset")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  yield* db
    .delete(SessionContextEpochTable)
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

const insert = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  generation: SystemContext.Generation,
) {
  const baselineSeq = yield* EventV2.latestSequence(db, sessionID)
  yield* db
    .insert(SessionContextEpochTable)
    .values({
      session_id: sessionID,
      baseline: generation.baseline,
      snapshot: generation.snapshot,
      baseline_seq: baselineSeq,
    })
    .run()
    .pipe(Effect.orDie)
  return baselineSeq
})

// Clears only the request this generation answers: one that landed after the row was read is
// kept, so the next preparation replaces again at that later boundary instead of losing it.
const replace = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
  generation: SystemContext.Generation,
  requested: number | null,
) {
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({
      baseline: generation.baseline,
      snapshot: generation.snapshot,
      baseline_seq: baselineSeq,
      replacement_seq: sql<
        number | null
      >`CASE WHEN ${SessionContextEpochTable.replacement_seq} IS ${requested} THEN NULL ELSE ${SessionContextEpochTable.replacement_seq} END`,
    })
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .returning({ sessionID: SessionContextEpochTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die("Context Epoch not found")
})

const advance = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  snapshot: SystemContext.Snapshot,
) {
  const updated = yield* db
    .update(SessionContextEpochTable)
    .set({ snapshot })
    .where(eq(SessionContextEpochTable.session_id, sessionID))
    .returning({ sessionID: SessionContextEpochTable.session_id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die("Context Epoch not found")
})
