import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260927095828_cache-root-lineage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`cache_root_id\` text;`)
      const sessions = yield* tx.all<{ id: string; parent_id: string | null; fork_session_id: string | null }>(
        `SELECT id, parent_id, fork_session_id FROM \`session_v2\``,
      )
      const byID = new Map(sessions.map((session) => [session.id, session]))
      yield* Effect.forEach(
        sessions.filter((session) => session.parent_id || session.fork_session_id),
        (session) => {
          const seen = new Set([session.id])
          let ancestor = session.parent_id ?? session.fork_session_id ?? session.id
          while (byID.has(ancestor) && !seen.has(ancestor)) {
            seen.add(ancestor)
            const parent = byID.get(ancestor)
            if (!parent) break
            const next = parent.parent_id ?? parent.fork_session_id
            if (!next) break
            ancestor = next
          }
          return tx.run(sql`UPDATE session_v2 SET cache_root_id = ${ancestor} WHERE id = ${session.id}`)
        },
        { discard: true },
      )
    })
  },
}

export default migration
