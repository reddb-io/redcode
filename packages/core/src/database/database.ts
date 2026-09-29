export * as Database from "./database.js"

import { EffectDrizzleSqlite } from "./drizzle.js"
import { sqliteLayer, supportsForeignKeyToggle, supportsTuningPragmas } from "#sqlite"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { SqlClient } from "effect/unstable/sql"
import { Global } from "@opencode/util/global"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

// One connection per process, and any number of processes on the same file: several TUIs,
// `serve`, `run` workers and the design app all open the same database. WAL keeps that safe:
// readers never block the one writer, and a process that dies mid-write leaves a WAL the next
// opener replays. Contention between writers is therefore the normal case, not an edge case.
const retry = { attempts: 6, baseDelayMs: 25, maxDelayMs: 800 }
const makeDatabase = EffectDrizzleSqlite.makeWithDefaults({
  // Every process may write, so a transaction takes the write lock as it begins: one that reads
  // before it writes would otherwise fail with SQLITE_BUSY_SNAPSHOT the moment another process
  // commits in between, and the busy timeout does not wait that out. When the lock is held past
  // the timeout, the whole transaction is begun again a few times with jittered delays, about 8 s
  // in all with the busy timeout below. Bodies are re-run whole, so a transaction body must only
  // touch the database. Migrations name their own, far larger, budget.
  transaction: { behavior: "immediate", retry },
  // A write outside a transaction commits on its own and waits on the same lock. A refused
  // autocommit statement changed nothing, so it is run again on the same budget.
  statement: { retry },
})
// RedDB coordinates writers itself and keeps drizzle's defaults. Durable Object SQLite runs its
// transactions natively, where begin mode and transaction retry do not apply.
const makeRemoteDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

/**
 * How long a statement waits for another process's lock before SQLITE_BUSY. Short, because the
 * wait blocks the thread (the SQLite drivers are synchronous) and every client of this process
 * stalls on it; the transaction and statement retries above, which sleep between attempts, do the
 * longer waiting.
 */
const BUSY_TIMEOUT_MS = 1000

export interface Interface {
  db: DatabaseShape
  remote?: boolean
}

export const Options = Schema.Struct({
  path: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/storage/Database") {}

// The bootstrap lock is scoped to the database being built, never to this
// module: on workerd every Durable Object in an isolate shares module state, and
// releasing a shared semaphore resumes the waiting object's fiber inside the
// releasing object's I/O context, where its first storage call is rejected as
// cross-object I/O.
const databaseLayer = (lock: Effect.Effect<Semaphore.Semaphore>, remote = false) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* remote ? makeRemoteDatabase : makeDatabase

      if (!remote && supportsTuningPragmas) {
        yield* db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
        yield* db.run("PRAGMA journal_mode = WAL")
        yield* db.run("PRAGMA synchronous = NORMAL")
        // The page cache is private to each process, while the file's pages already sit in the OS
        // page cache every process shares; a larger cache costs memory once per open client.
        yield* db.run("PRAGMA cache_size = -8000")
        yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
        // On the way out, before the connection closes: refresh the planner's statistics. The last
        // process to close the file checkpoints and removes the WAL by itself.
        yield* Effect.addFinalizer(() => db.run("PRAGMA optimize").pipe(Effect.ignore))
      }
      // Durable Object SQLite always enforces foreign keys and rejects the pragma.
      if (!remote && supportsForeignKeyToggle) yield* db.run("PRAGMA foreign_keys = ON")
      const semaphore = yield* lock
      yield* semaphore.withPermit(remote ? DatabaseMigration.applyRemote(db) : DatabaseMigration.apply(db))

      return { db, remote }
    }).pipe(Effect.orDie),
  )

// Instances opening the same file or RedDB URL in one process share a bootstrap lock.
// Remote processes still rely on the journal check inside each migration transaction.
const locks = new Map<string, Semaphore.Semaphore>()

function lockFor(filename: string) {
  const existing = locks.get(filename)
  if (existing) return existing
  const lock = Semaphore.makeUnsafe(1)
  locks.set(filename, lock)
  return lock
}

export function layer(options: Options = { path: ":memory:" }) {
  return Layer.unwrap(
    Effect.gen(function* () {
      if (options.url) {
        if (options.path) return yield* Effect.die(new Error("Database path and RedDB URL cannot be combined"))
        const { RedDBBackend } = yield* Effect.promise(() => import("#database-reddb"))
        return databaseLayer(Effect.succeed(lockFor(`reddb:${options.url}`)), true).pipe(
          Layer.provide(RedDBBackend.layer({ url: validateURL(options.url), token: options.token })),
        )
      }
      const provide = (filename: string) =>
        databaseLayer(filename === ":memory:" ? Semaphore.make(1) : Effect.succeed(lockFor(filename)), false).pipe(
          Layer.provide(sqliteLayer({ filename, timeout: BUSY_TIMEOUT_MS })),
        )
      const filename = options.path ?? ":memory:"
      if (filename === ":memory:" || isAbsolute(filename)) return provide(filename)
      const global = yield* Global.Service
      return provide(join(global.data, filename))
    }),
  )
}

// The database service over an injected SqlClient, for runtimes that receive
// database storage instead of opening a filesystem path. Any client provided
// here still goes through the pragma guards and migrations; Global is required
// because migrations may read it (the v1 import). The lock is created per build
// because every Durable Object builds this layer over its own storage.
export const layerFromClient: Layer.Layer<Service, never, SqlClient.SqlClient | Global.Service> = databaseLayer(
  Semaphore.make(1),
)

export function configured(options?: Options) {
  return makeGlobalNode({ service: Service, layer: layer(options), deps: [Global.node] })
}

/** `configured`, but over an injected SqlClient layer instead of a filesystem path. */
export function configuredClient(client: Layer.Layer<SqlClient.SqlClient>) {
  return makeGlobalNode({
    service: Service,
    layer: layerFromClient.pipe(Layer.provide(client)),
    deps: [Global.node],
  })
}

export const node = configured({ path: ":memory:" })

export function validateURL(value: string) {
  const url = new URL(value)
  if (!["red:", "reds:", "grpc:", "grpcs:", "http:", "https:"].includes(url.protocol))
    throw new Error(`Unsupported RedDB database URL protocol: ${url.protocol}`)
  if (url.username || url.password || url.search || url.hash)
    throw new Error("RedDB database URL must not contain credentials, query parameters or fragments")
  return value
}
