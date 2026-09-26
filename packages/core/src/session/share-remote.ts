import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import type { SessionSchema } from "./schema.js"
import { SessionShareTable } from "./redcode.sql.js"

/** Revoke before deleting a Session, while its share secret is still in the database. */
export const revoke = Effect.fn("SessionShare.revoke")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  const share = yield* db
    .select()
    .from(SessionShareTable)
    .where(eq(SessionShareTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!share) return
  yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${new URL(share.url).origin}/api/share/${encodeURIComponent(share.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: share.secret }),
        signal,
      })
      if (!response.ok) throw new Error(`Share service returned HTTP ${response.status}`)
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  })
})
