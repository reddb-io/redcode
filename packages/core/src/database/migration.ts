export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@reddb-io/redcode-effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
// Orders this process's own openers; processes order themselves on the database write lock below.
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

// Every step takes the write lock before it looks. Two processes opening the same file at the same
// moment therefore cannot both create the schema or both run a migration: the second waits, then
// sees what the first did and only fills in what is still missing.
const immediate = { behavior: "immediate" } as const

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const created = yield* db.transaction(
        (tx) =>
          Effect.gen(function* () {
            const tables = yield* tx.all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
            )
            if (tables.some((table) => table.name === "session")) return false
            if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")
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
      if (!created) yield* applyOnly(db, migrations)
    }),
  )
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.transaction((tx) => journal(tx, input), immediate)
    const completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* db.transaction(
        (tx) =>
          Effect.gen(function* () {
            // Another process may have run it between the read above and this lock.
            if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`)) return
            yield* migration.up(tx)
            yield* tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            )
          }),
        immediate,
      )
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
    const completed = yield* tx.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)
    if (completed.length > 0) return
    const legacy = yield* tx.get(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`,
    )
    if (!legacy) return
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
      if (!migration) {
        return yield* Effect.die(
          new Error(`Legacy migration timestamp ${entry.created_at} does not match any known migration`),
        )
      }
      yield* tx.run(sql`
        INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
        VALUES (${migration.id}, ${Date.now()})
      `)
    }
  })
}
