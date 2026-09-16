import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { isSqlError } from "effect/unstable/sql/SqlError"
import { EffectDrizzleSqlite } from "../src"

const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
})

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()
  yield* db.run(sql`create table users (id integer primary key autoincrement, name text not null)`)
  return db
})

const createMigrationsFolder = async () => {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "effect-drizzle-sqlite-"))
  await mkdir(join(migrationsFolder, "20240101000000_create_migrated_users"), { recursive: true })
  await Bun.write(
    join(migrationsFolder, "20240101000000_create_migrated_users", "migration.sql"),
    "create table migrated_users (id integer primary key autoincrement, name text not null);",
  )
  return migrationsFolder
}

test("selects rows through Effect-yieldable query builders", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.insert(users).values({ name: "Ada" })

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Ada" }])
      expect(yield* db.select({ id: users.id }).from(users).where(eq(users.name, "Ada")).get()).toEqual({ id: 1 })
    }),
  )
})

test("commits successful transactions", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db.transaction((tx) => tx.insert(users).values({ name: "Grace" }), { behavior: "immediate" })

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Grace" }])
    }),
  )
})

test("rolls back failed transactions", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Linus" })
            .pipe(Effect.andThen(Effect.fail("boom"))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("rolls back explicit transaction rollback", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Barbara" })
            .pipe(Effect.andThen(Effect.fail(tx.rollback()))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("preserves failed transaction begin errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "effect-drizzle-sqlite-"))
  const filename = join(dir, "locked.db")
  const holder = new Database(filename)

  try {
    holder.run("create table users (id integer primary key autoincrement, name text not null)")
    holder.run("pragma busy_timeout = 0")
    holder.run("begin immediate")

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.run(sql`pragma busy_timeout = 0`)

        const error = yield* db
          .transaction((tx) => tx.insert(users).values({ name: "Blocked" }), { behavior: "immediate" })
          .pipe(Effect.flip)

        if (!isSqlError(error)) throw new Error("Expected SqlError")
        expect(error.reason._tag).toBe("LockTimeoutError")
        expect(error.reason.cause instanceof Error ? error.reason.cause.message : "").toContain("database is locked")
      }).pipe(Effect.provide(SqliteClient.layer({ filename, disableWAL: true })), Effect.scoped),
    )
  } finally {
    if (holder.inTransaction) holder.run("rollback")
    holder.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** A second connection to the same file, as another process would hold it. */
const withHolder = async (fn: (filename: string, holder: Database) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "effect-drizzle-sqlite-"))
  const filename = join(dir, "shared.db")
  const holder = new Database(filename)
  try {
    holder.run("pragma journal_mode = WAL")
    holder.run("pragma busy_timeout = 0")
    holder.run("create table users (id integer primary key autoincrement, name text not null)")
    await fn(filename, holder)
  } finally {
    if (holder.inTransaction) holder.run("rollback")
    holder.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const onFile = <A, E>(filename: string, effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename })), Effect.scoped))

test("begins every transaction in the configured mode", async () => {
  await withHolder(async (filename, holder) => {
    holder.run("begin immediate")
    await onFile(
      filename,
      Effect.gen(function* () {
        const deferred = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* deferred.run(sql`pragma busy_timeout = 0`)
        // A deferred transaction only reads here, so the other writer does not stop it.
        expect(yield* deferred.transaction((tx) => tx.select().from(users))).toEqual([])

        const immediate = yield* EffectDrizzleSqlite.makeWithDefaults({ transaction: { behavior: "immediate" } })
        const error = yield* immediate.transaction((tx) => tx.select().from(users)).pipe(Effect.flip)
        expect(EffectDrizzleSqlite.isLockError(error)).toBe(true)
      }),
    )
  })
})

test("retries a locked outermost transaction as a whole once the lock is released", async () => {
  await withHolder(async (filename, holder) => {
    holder.run("begin immediate")
    const release = setTimeout(() => holder.run("commit"), 150)
    try {
      await onFile(
        filename,
        Effect.gen(function* () {
          const db = yield* EffectDrizzleSqlite.makeWithDefaults({
            transaction: { behavior: "immediate", retry: { attempts: 8, baseDelayMs: 20, maxDelayMs: 80 } },
          })
          yield* db.run(sql`pragma busy_timeout = 0`)
          let bodies = 0
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              bodies++
              yield* tx.insert(users).values({ name: "Retried" })
            }),
          )
          // The lock is taken before the body: a body never runs against a lock it did not get.
          expect(bodies).toBe(1)
          expect(yield* db.select({ name: users.name }).from(users)).toEqual([{ name: "Retried" }])
        }),
      )
    } finally {
      clearTimeout(release)
    }
  })
})

test("gives up after the configured attempts while the lock is still held", async () => {
  await withHolder(async (filename, holder) => {
    holder.run("begin immediate")
    await onFile(
      filename,
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults({
          transaction: { behavior: "immediate", retry: { attempts: 2, baseDelayMs: 5, maxDelayMs: 10 } },
        })
        yield* db.run(sql`pragma busy_timeout = 0`)
        const error = yield* db.transaction((tx) => tx.insert(users).values({ name: "Blocked" })).pipe(Effect.flip)
        expect(EffectDrizzleSqlite.isLockError(error)).toBe(true)
      }),
    )
  })
})

test("an immediate transaction keeps a competing writer out between its read and its write", async () => {
  await withHolder(async (filename, holder) => {
    const interleave = () =>
      Effect.sync(() => {
        try {
          holder.run("insert into users (name) values ('Other process')")
          return "wrote"
        } catch (error) {
          return error instanceof Error && "code" in error ? String(error.code) : "failed"
        }
      })
    const readThenWrite = (db: EffectDrizzleSqlite.EffectSQLiteDatabase) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.select().from(users)
          const other = yield* interleave()
          yield* tx.insert(users).values({ name: "Mine" })
          return other
        }),
      )

    await onFile(
      filename,
      Effect.gen(function* () {
        // Deferred: the read took a snapshot, the other writer committed, and the write upgrade
        // fails with SQLITE_BUSY_SNAPSHOT, which no busy timeout waits out.
        const deferred = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* deferred.run(sql`pragma busy_timeout = 5000`)
        const error = yield* readThenWrite(deferred).pipe(Effect.flip)
        expect(EffectDrizzleSqlite.isLockError(error)).toBe(true)

        // Immediate: the write lock is held from the start, so the other writer is the one told
        // the database is busy, and this transaction commits what it read against.
        const immediate = yield* EffectDrizzleSqlite.makeWithDefaults({ transaction: { behavior: "immediate" } })
        expect(yield* readThenWrite(immediate)).toBe("SQLITE_BUSY")
        expect(yield* immediate.select({ name: users.name }).from(users)).toEqual([
          { name: "Other process" },
          { name: "Mine" },
        ])
      }),
    )
  })
})

test("supports returning and rejects empty update sets", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      const inserted = yield* db.insert(users).values({ name: "Ada" }).returning({ id: users.id, name: users.name })
      expect(inserted).toEqual([{ id: 1, name: "Ada" }])

      const updated = yield* db.update(users).set({ name: "Grace" }).where(eq(users.id, 1)).returning()
      expect(updated).toEqual([{ id: 1, name: "Grace" }])

      const deleted = yield* db.delete(users).where(eq(users.id, 1)).returning({ id: users.id })
      expect(deleted).toEqual([{ id: 1 }])

      expect(() => db.update(users).set({ name: undefined })).toThrow("No values to set")
    }),
  )
})

test("runs migrations once and records migration metadata", async () => {
  const migrationsFolder = await createMigrationsFolder()
  try {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()

        yield* EffectDrizzleSqlite.migrate(db, { migrationsFolder })
        yield* EffectDrizzleSqlite.migrate(db, { migrationsFolder })
        yield* db.run(sql`insert into migrated_users (name) values ('Margaret')`)

        expect(yield* db.all<{ name: string }>(sql`select name from migrated_users`)).toEqual([{ name: "Margaret" }])
        expect(yield* db.all<{ name: string | null }>(sql`select name from __drizzle_migrations`)).toEqual([
          { name: "20240101000000_create_migrated_users" },
        ])
      }),
    )
  } finally {
    await rm(migrationsFolder, { recursive: true, force: true })
  }
})
