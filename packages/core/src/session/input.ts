export * as SessionInput from "./input"

import { and, asc, eq, isNull, lte } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Admitted, Delivery } from "@reddb-io/redcode-schema/session-input"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionV1 } from "../v1/session"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export class NotPending extends Schema.TaggedErrorClass<NotPending>()("SessionInput.NotPending", {
  id: SessionMessage.ID,
}) {}

// Changes the delivery of a prompt that is still waiting in the inbox. The change is a durable
// event whose projection runs in the same transaction as its append: when the row was promoted or
// removed in the meantime the projection refuses it, so the event is never stored and the caller
// learns the prompt is no longer pending. Returns the row as it stands after the change, or
// `undefined` when there is no pending prompt with this id in the session.
export const setDelivery = Effect.fn("SessionInput.setDelivery")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly id: SessionMessage.ID
    readonly delivery: Delivery
  },
) {
  const existing = yield* find(db, input.id)
  if (existing === undefined || existing.sessionID !== input.sessionID || existing.promotedSeq !== undefined)
    return undefined
  if (existing.delivery === input.delivery) return existing
  const changed = yield* events
    .publish(
      SessionEvent.PromptDeliveryChanged,
      {
        sessionID: input.sessionID,
        messageID: input.id,
        timestamp: yield* DateTime.now,
        delivery: input.delivery,
      },
      // The pending check belongs to this write, not to the event: a commit hook is committed
      // atomically with the append and never replayed, so a prompt promoted or removed between the
      // read above and the append rolls the whole thing back and the caller hears "not pending",
      // while a replica replaying the same event later is not held to a race it cannot re-observe.
      { commit: () => assertPending(db, input) },
    )
    .pipe(
      Effect.as(true),
      Effect.catchDefect((defect) => (defect instanceof NotPending ? Effect.succeed(false) : Effect.die(defect))),
    )
  if (!changed) return undefined
  return Admitted.make({ ...existing, delivery: input.delivery })
})

// Discards a V1 prompt that is still waiting in the inbox, before its promotion. The admitted
// message is removed with a durable `message.removed`, whose projection drops the pending row with
// it (the path a revert takes). The pending check is a commit hook, as in `setDelivery`: the
// projection only deletes a row that is still pending, so a row left afterwards was promoted in
// the meantime; the whole write then rolls back and the caller hears "not pending" instead of a
// promoted message vanishing from history. Returns whether the prompt was discarded.
export const discard = Effect.fn("SessionInput.discard")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly id: SessionMessage.ID
  },
) {
  const existing = yield* find(db, input.id)
  if (existing === undefined || existing.sessionID !== input.sessionID || existing.promotedSeq !== undefined)
    return false
  return yield* events
    .publish(
      SessionV1.Event.MessageRemoved,
      { sessionID: input.sessionID, messageID: SessionV1.MessageID.make(input.id) },
      {
        commit: () =>
          find(db, input.id).pipe(
            Effect.flatMap((row) => (row === undefined ? Effect.void : Effect.die(new NotPending({ id: input.id })))),
          ),
      },
    )
    .pipe(
      Effect.as(true),
      Effect.catchDefect((defect) => (defect instanceof NotPending ? Effect.succeed(false) : Effect.die(defect))),
    )
})

// Idempotent, because this also runs on replay: a workspace rebuilding its projection, a partial
// replay, or a row this replica already promoted all reach here with nothing left to change, and a
// projector that died there would fail the whole sync. Only the write path holds the prompt to
// being pending, through the commit hook below.
export const projectDeliveryChanged = Effect.fn("SessionInput.projectDeliveryChanged")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly delivery: Delivery
  },
) {
  const updated = yield* setPendingDelivery(db, input)
  if (!updated)
    yield* Effect.logDebug("prompt delivery change skipped; the prompt is no longer pending", {
      "session.id": input.sessionID,
      messageID: input.id,
      delivery: input.delivery,
    })
})

const setPendingDelivery = (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly delivery: Delivery
  },
) =>
  db
    .update(SessionInputTable)
    .set({ delivery: input.delivery })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie, Effect.map((row) => row !== undefined))

// The write path's guarantee, run inside the append transaction: the projector above has just
// changed the row if it could, so a row that is not pending now was promoted or removed by someone
// else, and the event must not be stored at all.
const assertPending = Effect.fn("SessionInput.assertPending")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly delivery: Delivery
  },
) {
  const row = yield* db
    .select({ delivery: SessionInputTable.delivery, promoted: SessionInputTable.promoted_seq })
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.id, input.id), eq(SessionInputTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (row === undefined || row.promoted !== null || row.delivery !== input.delivery)
    return yield* Effect.die(new NotPending({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const listPending = Effect.fn("SessionInput.listPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  filter?: { readonly delivery?: Delivery; readonly cutoffSeq?: number },
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        ...(filter?.delivery === undefined ? [] : [eq(SessionInputTable.delivery, filter.delivery)]),
        ...(filter?.cutoffSeq === undefined ? [] : [lte(SessionInputTable.admitted_seq, filter.cutoffSeq)]),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map(fromRow)
})

// A V1 session keeps its user message in the canonical `message` table, so its inbox row is a
// sidecar: promotion is the durable re-publication of that message, not a `Prompted` event (which
// would project a second, V2 user row). The projector calls this for the durable
// `message.promoted` event the V1 loop publishes right after that re-publication, so promotion
// is explicit (a retried `message.updated` never promotes anything) and replayed: sync and steal
// rebuild the projection from the aggregate and the row comes back stamped.
export const projectLegacyPromotion = Effect.fn("SessionInput.projectLegacyPromotion")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  return updated !== undefined
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

export const matchesPrompt = (
  input: Admitted,
  expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt },
) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  for (const row of rows) {
    const id = SessionMessage.ID.make(row.id)
    yield* events
      .publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: decodePrompt(row.prompt),
        delivery: row.delivery,
      })
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : Effect.die(defect),
        ),
      )
  }
  return rows.length
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})
