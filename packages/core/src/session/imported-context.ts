export * as SessionImportedContext from "./imported-context.js"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database.js"
import { Instructions } from "../instructions/index.js"
import { InstructionStateTable } from "./sql.js"
import { RedcodeSessionContextEpochTable } from "./redcode-legacy.sql.js"
import { SessionSchema } from "./schema.js"

type DatabaseService = Database.Interface["db"]
const key = Instructions.Key.make("redcode/legacy-baseline")

/** Begin with the exact imported baseline, then admit current sources chronologically. */
export const load = Effect.fn("SessionImportedContext.load")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const legacy = yield* db
    .select({
      baseline: RedcodeSessionContextEpochTable.baseline,
      replacement: RedcodeSessionContextEpochTable.replacement_seq,
    })
    .from(RedcodeSessionContextEpochTable)
    .where(eq(RedcodeSessionContextEpochTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!legacy) return
  // The importer requested a new epoch before stopping; its previous baseline must not be reused.
  if (legacy.replacement !== null) return
  // A session already resumed under the current runtime has its own instruction epoch. Do not rewind it on upgrade.
  const state = yield* db
    .select({ values: InstructionStateTable.current_values })
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (state && !Object.hasOwn(state.values, key)) return
  if (!legacy.baseline) return { phase: "baseline" as const, instructions: Instructions.empty }
  const transition = !!state
  return {
    phase: transition ? ("transition" as const) : ("baseline" as const),
    instructions: Instructions.make({
      key,
      codec: Schema.toCodecJson(Schema.String),
      read: Effect.succeed(transition ? Instructions.removed : legacy.baseline),
      render: {
        initial: (baseline) => baseline,
        changed: (_previous, baseline) => baseline,
        removed: () => "The imported instruction baseline no longer applies; current instructions follow.",
      },
    }),
  }
})

/** End the imported epoch only after a durable compaction has committed. */
export const retire = Effect.fn("SessionImportedContext.retire")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const state = yield* db
    .select({ values: InstructionStateTable.current_values })
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  const removed = yield* db
    .delete(RedcodeSessionContextEpochTable)
    .where(eq(RedcodeSessionContextEpochTable.session_id, sessionID))
    .returning({ sessionID: RedcodeSessionContextEpochTable.session_id })
    .get()
    .pipe(Effect.orDie)
  return !!removed && !!state && Object.hasOwn(state.values, key)
})

/** A fork adopts the parent's newest instruction epoch, including an imported baseline. */
export const fork = Effect.fn("SessionImportedContext.fork")(function* (
  db: DatabaseService,
  parentID: SessionSchema.ID,
  sessionID: SessionSchema.ID,
) {
  const parent = yield* db
    .select()
    .from(RedcodeSessionContextEpochTable)
    .where(eq(RedcodeSessionContextEpochTable.session_id, parentID))
    .get()
    .pipe(Effect.orDie)
  if (!parent) return
  const state = yield* db
    .select({ values: InstructionStateTable.current_values })
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, parentID))
    .get()
    .pipe(Effect.orDie)
  if (state && !Object.hasOwn(state.values, key)) return
  yield* db
    .insert(RedcodeSessionContextEpochTable)
    .values({ ...parent, session_id: sessionID })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})
