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

// SQLite's primary result codes, by number, for drivers that only report the number.
const codes = [
  "OK",
  "ERROR",
  "INTERNAL",
  "PERM",
  "ABORT",
  "BUSY",
  "LOCKED",
  "NOMEM",
  "READONLY",
  "INTERRUPT",
  "IOERR",
  "CORRUPT",
  "NOTFOUND",
  "FULL",
  "CANTOPEN",
  "PROTOCOL",
  "EMPTY",
  "SCHEMA",
  "TOOBIG",
  "CONSTRAINT",
  "MISMATCH",
  "MISUSE",
  "NOLFS",
  "AUTH",
  "FORMAT",
  "RANGE",
  "NOTADB",
]

/**
 * The message for a statement SQLite refused, naming what ran and why:
 * "Failed to execute statement (INSERT, SQLITE_BUSY: database is locked)". The bare
 * "Failed to execute statement" left a crashed turn with nothing to tell a lock wait that ran out
 * from a constraint or a full disk. Reads bun:sqlite's string `code` and node:sqlite's numeric
 * `errcode`; never includes parameters, which may hold user content.
 */
export const failure = (cause: unknown, query: string) => {
  const kind = /^\s*([A-Za-z]+)/.exec(query)?.[1]?.toUpperCase() ?? "SQL"
  if (typeof cause !== "object" || cause === null) return `Failed to execute statement (${kind})`
  const error = cause as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown }
  const code =
    typeof error.code === "string" && error.code.startsWith("SQLITE_")
      ? error.code
      : typeof error.errcode === "number"
        ? `SQLITE_${codes[error.errcode & 0xff] ?? error.errcode}`
        : undefined
  const detail = [error.errstr, error.message].find(
    (text): text is string => typeof text === "string" && text.length > 0,
  )
  return `Failed to execute statement (${[kind, [code, detail].filter(Boolean).join(": ")].filter(Boolean).join(", ")})`
}
