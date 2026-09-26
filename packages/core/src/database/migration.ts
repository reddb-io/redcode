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

// Not serialized here: the Database layer holds a lock scoped to the database
// it is bootstrapping, since two instances over one file must not race.
export function apply(db: Database) {
  return Effect.gen(function* () {
    // OpenCode owns the unprefixed table namespace. Embedders sharing this
    // database may own underscore-prefixed tables, which bootstrap ignores.
    const tables = yield* db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'`,
    )
    if (tables.some((table) => table.name === "session" || table.name === "session_v2"))
      return yield* applyOnly(db, migrations)
    if (tables.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))
    const started = Date.now()
    yield* Effect.logInfo("database schema bootstrap started", { migrations: migrations.length })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* schema.up(tx)
        yield* tx.run(
          sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
        )
        yield* Effect.forEach(migrations, (migration) =>
          tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          ),
        )
      }),
    )
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
      if (journal.success.some((entry) => entry.id === REMOTE_BOOTSTRAP)) return yield* bootstrapRemote(db)
      if (journal.success.length > 0) return yield* applyOnly(db, migrations, { remote: true })
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
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0 && !options.remote) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        const named = (yield* db.all<{ name: string }>(
          sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`,
        )).some((column) => column.name === "name")

        if (named) {
          yield* db.run(sql`
            INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
            SELECT name, ${Date.now()}
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE name IS NOT NULL
          `)
        }

        if (!named) {
          const entries = yield* db.all<{ created_at: number; prefix: string | null }>(sql`
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
            yield* db.run(sql`
              INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
              VALUES (${migration.id}, ${Date.now()})
            `)
          }
        }
        completed = new Set(
          (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      const started = Date.now()
      yield* Effect.logInfo("database migration started", { migration: migration.id })
      const apply = db.transaction((tx) =>
        Effect.gen(function* () {
          yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
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
              yield* apply.pipe(Effect.ensuring(restoreForeignKeys.pipe(Effect.orDie)))
            })
      yield* run.pipe(
        Effect.tapError((error) =>
          Effect.logError("database migration failed", {
            migration: migration.id,
            durationMs: Date.now() - started,
            error,
          }),
        ),
      )
      yield* Effect.logInfo("database migration completed", {
        migration: migration.id,
        durationMs: Date.now() - started,
      })
    }
  })
}
