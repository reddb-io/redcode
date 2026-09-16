export * as Sqlite from "./sqlite"

import { Context, Effect } from "effect"
import type { drizzle } from "drizzle-orm/bun-sqlite"

export type DrizzleClient = ReturnType<typeof drizzle>
export class Native extends Context.Service<Native, unknown>()("@reddb-io/redcode-core/database/SqliteNative") {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()(
  "@reddb-io/redcode-core/database/SqliteDrizzle",
) {}

const busy = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "SQLITE_BUSY") ||
    ("errcode" in error && error.errcode === 5) ||
    ("message" in error && typeof error.message === "string" && /database is locked/i.test(error.message)))

/**
 * Switches a connection to WAL, trying again for a while when another process is switching the
 * same new file at the same moment. That switch needs the file to itself, and when two
 * connections both hold a read lock SQLite answers SQLITE_BUSY at once instead of waiting on the
 * busy timeout. A file already in WAL needs no switch and never waits.
 */
export const enableWal = (run: () => void): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      try {
        return run()
      } catch (error) {
        if (attempt >= 50 || !busy(error)) return yield* Effect.die(error)
      }
      yield* Effect.sleep(Math.round(20 * Math.min(attempt + 1, 8) * (0.5 + Math.random())))
    }
  })
