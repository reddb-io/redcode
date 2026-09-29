export * as DatabaseMigration from "./migration.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { supportsForeignKeyToggle } from "#sqlite"
import type { EffectDrizzleSqlite } from "./drizzle.js"
import { migrations } from "./migration.gen.js"
import schema from "./schema.gen.js"
import { Global } from "@opencode/util/global"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

export type Migration = {
  id: string
  foreignKeys?: boolean
  up: (tx: Transaction) => Effect.Effect<void, unknown, Global.Service>
}

// Every local step takes the write lock before it looks. Two processes opening the same file at
// the same moment therefore cannot both create the schema or both run a migration: the second
// waits, then sees what the first did and only fills in what is still missing. It waits far
// longer than an ordinary transaction would: the first process may be rebuilding a large table,
// and a second process must not die at boot because of it. 600 attempts, each a busy wait of up
// to the busy timeout plus a sleep of up to 1 s, with a log line per wait.
const immediate = {
  behavior: "immediate",
  retry: {
    attempts: 600,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    onRetry: (attempt: number, delayMs: number) =>
      Effect.logInfo("waiting for another process to finish migrating the database", { attempt, delayMs }),
  },
} as const

// The Database layer also holds a lock scoped to the database it is bootstrapping, which orders
// the openers of one process; processes order themselves on the write lock above.
export function apply(db: Database) {
  return Effect.gen(function* () {
    const started = Date.now()
    const created = yield* db.transaction(
      (tx) =>
        Effect.gen(function* () {
          // OpenCode owns the unprefixed table namespace. Embedders sharing this
          // database may own underscore-prefixed tables, which bootstrap ignores.
          const tables = yield* tx.all<{ name: string }>(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'`,
          )
          if (tables.some((table) => table.name === "session" || table.name === "session_v2")) return false
          if (tables.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))
          yield* Effect.logInfo("database schema bootstrap started", { migrations: migrations.length })
          yield* schema.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
          return true
        }),
      immediate,
    )
    if (!created) return yield* applyOnly(db, migrations)
    yield* Effect.logInfo("database schema bootstrap completed", {
      migrations: migrations.length,
      durationMs: Date.now() - started,
    })
  })
}

const REMOTE_BOOTSTRAP = "__redcode_schema_bootstrap__"

export function applyRemote(db: Database) {
  return Effect.gen(function* () {
    const journal = yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`).pipe(Effect.result)
    if (journal._tag === "Success") {
      const completed = new Set(journal.success.map((entry) => entry.id))
      if (completed.size > 0) {
        const v2 = yield* db.get(sql`SELECT id FROM ${sql.identifier("session_v2")} LIMIT 1`).pipe(Effect.result)
        const v1 = yield* db.get(sql`SELECT id FROM ${sql.identifier("session")} LIMIT 1`).pipe(Effect.result)
        if (
          v1._tag === "Success" &&
          !completed.has("20260804233008_loose_psylocke") &&
          !completed.has("20260730195856_optional_session_title")
        )
          return yield* Effect.die(new Error("V1 RedDB session history requires explicit V1-to-V2 import"))
        if (completed.has("20260804233008_loose_psylocke") && v2._tag === "Failure")
          return yield* Effect.die(new Error("Remote RedDB migration journal references a missing session_v2 table"))
        if (completed.has(REMOTE_BOOTSTRAP)) return yield* bootstrapRemote(db)
        return yield* applyOnly(db, migrations, { remote: true })
      }
    }
    const session = yield* db.get(sql`SELECT id FROM ${sql.identifier("session_v2")} LIMIT 1`).pipe(Effect.result)
    const legacy = yield* db.get(sql`SELECT id FROM ${sql.identifier("session")} LIMIT 1`).pipe(Effect.result)
    if (session._tag === "Success" || legacy._tag === "Success")
      return yield* Effect.die(new Error("Remote RedDB has session tables but no migration journal"))
    return yield* bootstrapRemote(db)
  })
}

function bootstrapRemote(db: Database) {
  return Effect.gen(function* () {
    // RedDB may retain DDL from a failed transaction. The marker makes a retry resume the bootstrap.
    yield* db.run(sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
    yield* db.run(sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${REMOTE_BOOTSTRAP}, ${Date.now()}) ON CONFLICT (id) DO NOTHING`)
    yield* db.transaction((tx) => schema.up(tx))
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* Effect.forEach(migrations, (migration) =>
          tx.run(sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()}) ON CONFLICT (id) DO NOTHING`),
        )
        yield* tx.run(sql`DELETE FROM ${sql.identifier("migration")} WHERE id = ${REMOTE_BOOTSTRAP}`)
      }),
    )
  })
}

export function applyOnly(db: Database, input: Migration[], options: { remote?: boolean } = {}) {
  return Effect.gen(function* () {
    if (options.remote)
      yield* db.run(
        sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
      )
    if (!options.remote) yield* db.transaction((tx) => journal(tx, input), immediate)
    const completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      const started = Date.now()
      yield* Effect.logInfo("database migration started", { migration: migration.id })
      const apply = db.transaction(
        (tx) =>
          Effect.gen(function* () {
            // Another process may have run it between the read above and this lock.
            if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`))
              return false
            yield* migration.up(tx)
            yield* tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            )
            return true
          }),
        options.remote ? undefined : immediate,
      )
      const run =
        migration.foreignKeys !== false || options.remote
          ? apply
          : Effect.gen(function* () {
              // Durable Object SQLite rejects the foreign_keys toggle; the closest
              // allowlisted relaxation is deferring enforcement to transaction commit.
              const relaxForeignKeys = supportsForeignKeyToggle
                ? db.run(sql`PRAGMA foreign_keys = OFF`)
                : db.run(sql`PRAGMA defer_foreign_keys = ON`)
              const restoreForeignKeys = supportsForeignKeyToggle ? db.run(sql`PRAGMA foreign_keys = ON`) : Effect.void
              yield* relaxForeignKeys
              return yield* apply.pipe(Effect.ensuring(restoreForeignKeys.pipe(Effect.orDie)))
            })
      const applied = yield* run.pipe(
        Effect.tapError((error) =>
          Effect.logError("database migration failed", {
            migration: migration.id,
            durationMs: Date.now() - started,
            error,
          }),
        ),
      )
      if (!applied) continue
      yield* Effect.logInfo("database migration completed", {
        migration: migration.id,
        durationMs: Date.now() - started,
      })
    }
  })
}

/**
 * The migration journal, seeded once from Drizzle's journal on installs that predate it so
 * TypeScript migrations do not replay old SQL. Every statement here is idempotent, so a second
 * process repeating it changes nothing.
 */
function journal(tx: Transaction, input: Migration[]) {
  return Effect.gen(function* () {
    yield* tx.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} LIMIT 1`)) return
    if (!(yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)))
      return
    const named = (yield* tx.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`,
    )).some((column) => column.name === "name")

    if (named) {
      yield* tx.run(sql`
        INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
        SELECT name, ${Date.now()}
        FROM ${sql.identifier("__drizzle_migrations")}
        WHERE name IS NOT NULL
      `)
      return
    }

    const entries = yield* tx.all<{ created_at: number; prefix: string | null }>(sql`
      SELECT created_at, strftime('%Y%m%d%H%M%S', created_at / 1000, 'unixepoch') AS prefix
      FROM ${sql.identifier("__drizzle_migrations")}
      WHERE created_at IS NOT NULL
    `)

    for (const entry of entries) {
      const migration = input.find((item) => item.id.startsWith(`${entry.prefix}_`))
      if (!migration)
        return yield* Effect.die(
          new Error(`Legacy migration timestamp ${entry.created_at} does not match any known migration`),
        )
      yield* tx.run(sql`
        INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
        VALUES (${migration.id}, ${Date.now()})
      `)
    }
  })
}
