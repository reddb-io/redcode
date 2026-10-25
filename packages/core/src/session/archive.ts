export * as SessionArchive from "./archive.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { BusyError } from "./error.js"
import type { SessionSchema } from "./schema.js"

/** Also protect descendants while an archived parent retains the family history. */
export const writableGate = (sessionID: SessionSchema.ID) => sql`NOT EXISTS (
  WITH RECURSIVE lineage(id, parent_id, archived) AS (
    SELECT id, parent_id, time_archived FROM session_v2 WHERE id = ${sessionID}
    UNION
    SELECT s.id, s.parent_id, s.time_archived FROM session_v2 s JOIN lineage l ON s.id = l.parent_id
  ) SELECT id FROM lineage WHERE archived IS NOT NULL
)`

export const requireWritable = Effect.fn("SessionArchive.requireWritable")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  const archived = yield* db.get(sql`SELECT 1 WHERE NOT ${writableGate(sessionID)}`).pipe(Effect.orDie)
  if (archived) return yield* new BusyError({ sessionID, reason: "Restore the archived session before adding work" })
})

/** Runs in the event transaction: admission and execution acquisition cannot pass this snapshot. */
export const requireSettled = Effect.fn("SessionArchive.requireSettled")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  const pending = yield* db
    .get(
      sql`
    WITH RECURSIVE family(id) AS (
      SELECT id FROM session_v2 WHERE id = ${sessionID}
      UNION
      SELECT s.id FROM session_v2 s JOIN family f ON s.parent_id = f.id
    )
    SELECT 1 AS pending WHERE
      EXISTS (SELECT 1 FROM session_v2 s JOIN family f ON s.id = f.id
        WHERE s.execution_owner IS NOT NULL OR s.time_suspended IS NOT NULL)
      OR EXISTS (SELECT 1 FROM session_inbox i JOIN family f ON i.session_id = f.id)
      OR EXISTS (SELECT 1 FROM session_message m JOIN family f ON m.session_id = f.id
        WHERE m.type = 'shell' AND json_extract(m.data, '$.status') = 'running')
      OR EXISTS (SELECT 1 FROM session_goal g JOIN family f ON g.session_id = f.id
        WHERE json_extract(g.data, '$.status') != 'done')
      OR EXISTS (SELECT 1 FROM todo t JOIN family f ON t.session_id = f.id
        WHERE t.status NOT IN ('completed', 'cancelled')
          OR json_extract(t.details, '$.integrationApplication.state') = 'pending')
      OR EXISTS (SELECT 1 FROM worker_lease w JOIN family f ON w.session_id = f.id
        WHERE w.released = 0)
      OR EXISTS (SELECT 1 FROM kv k WHERE k.key LIKE 'job.background/%' AND (
        json_extract(k.value, '$.recovery.sessionID') IN (SELECT id FROM family)
        OR json_extract(k.value, '$.recovery.parentSessionID') IN (SELECT id FROM family)
        OR json_extract(k.value, '$.recovery.childSessionID') IN (SELECT id FROM family)))
  `,
    )
    .pipe(Effect.orDie)
  if (pending)
    return yield* new BusyError({
      sessionID,
      reason: "Finish execution and pending work, including descendants, before archiving",
    })
})
