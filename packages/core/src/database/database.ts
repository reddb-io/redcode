export * as Database from "./database"

import { EffectDrizzleSqlite } from "@reddb-io/redcode-effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import fs from "node:fs/promises"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { existsSync } from "fs"
import { isAbsolute, join } from "path"
import { parse } from "jsonc-parser"
import { DatabaseMigration } from "./migration"
import { redDBLayer } from "./reddb"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

// One connection per process, shared by every service in it, and any number of processes on the
// same file: several TUIs, `redcode serve`, `redcode run` workers and the design server all open
// `<data>/redcode.db`. SQLite keeps that safe on its own in WAL mode, where readers never block
// the one writer, and a process that dies mid-write leaves a WAL the next opener replays. Nothing
// copies, moves or exclusively locks the file while it is open.
const makeDatabase = EffectDrizzleSqlite.makeWithDefaults({
  // Every process may write, so a transaction takes the write lock as it begins: one that reads
  // before it writes would otherwise fail with SQLITE_BUSY_SNAPSHOT the moment another process
  // commits in between, and the busy timeout does not wait that out. When the lock is held past
  // the timeout, the whole transaction is begun again a few times with jittered delays: with the
  // busy timeout below, contention surfaces after about 8 s in all. Bodies are re-run whole, so
  // a transaction body must only touch the database; anything for listeners goes through
  // `EffectDrizzleSqlite.afterCommit`. Migrations name their own, far larger, budget.
  transaction: { behavior: "immediate", retry: { attempts: 6, baseDelayMs: 25, maxDelayMs: 800 } },
})
const makeRemoteDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/storage/Database") {}

const databaseLayer = (remote: boolean) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* remote ? makeRemoteDatabase : makeDatabase

      if (remote) {
        yield* DatabaseMigration.apply(db, { remote: true })
        return { db }
      }

      // The native layer opened the connection with the busy timeout below already in force and
      // switched the file to WAL (`Sqlite.enableWal`), so neither is repeated here.
      // Durable against a Redcode crash, not against power loss: the last commits before an OS
      // crash may be lost, but the file is never corrupted. The right trade for a local tool;
      // FULL would fsync the WAL on every commit.
      yield* db.run("PRAGMA synchronous = NORMAL")
      // SQLite's page cache is private to each process, while the file's pages already sit in the OS
      // page cache that every process shares. On a 500 MB database a scan filled a 64 MB cache (+87 MB
      // resident per process, once for every open TUI) and ran no faster than with 8 MB (+20 MB).
      yield* db.run("PRAGMA cache_size = -8000")
      yield* db.run("PRAGMA foreign_keys = ON")
      // Fold a WAL a crashed process left behind back into the file; from here the default
      // autocheckpoint (every 1000 pages) keeps it bounded.
      yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      yield* DatabaseMigration.apply(db)
      // On the way out, before the connection closes: refresh the planner's statistics. The last
      // process to close the file checkpoints and removes the WAL by itself.
      yield* Effect.addFinalizer(() => db.run("PRAGMA optimize").pipe(Effect.ignore))

      return { db }
    }).pipe(Effect.orDie),
  )

/**
 * How long a statement waits for another process's lock before SQLITE_BUSY, from the first one.
 * Short, because the wait blocks the thread (bun:sqlite is synchronous) and a TUI must not hang
 * on it; the transaction retry above, which sleeps between attempts, does the longer waiting.
 */
const BUSY_TIMEOUT_MS = 1000

export function layerFromPath(filename: string) {
  return databaseLayer(false).pipe(Layer.provide(sqliteLayer({ filename, timeout: BUSY_TIMEOUT_MS })))
}

export function layerFromURL(url: string, token?: string) {
  return databaseLayer(true).pipe(Layer.provide(redDBLayer({ url, ...(token ? { token } : {}) })), Layer.orDie)
}

export function path() {
  if (Flag.REDCODE_DB) {
    if (Flag.REDCODE_DB === ":memory:" || isAbsolute(Flag.REDCODE_DB)) return Flag.REDCODE_DB
    return join(Global.Path.data, Flag.REDCODE_DB)
  }
  const stable =
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.REDCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.REDCODE_DISABLE_CHANNEL_DB === "true"
  const suffix = stable ? "" : `-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}`
  const current = join(Global.Path.data, `redcode${suffix}.db`)
  const legacy = join(Global.Path.data, `opencode${suffix}.db`)
  return !existsSync(current) && existsSync(legacy) ? legacy : current
}

export async function selection() {
  const environment = Flag.REDCODE_DATABASE_URL?.trim()
  if (environment)
    return { backend: "reddb" as const, location: validateURL(environment), source: "environment" as const }

  const configured = (
    await Promise.all(
      ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"].map(
        async (name) => {
          const content = await fs.readFile(join(Global.Path.config, name), "utf8").catch(() => undefined)
          if (!content) return undefined
          const value: unknown = parse(content)
          if (typeof value !== "object" || value === null || !("database" in value)) return undefined
          const database = value.database
          if (typeof database !== "object" || database === null || !("url" in database)) return undefined
          return typeof database.url === "string" && database.url.trim() ? database.url.trim() : undefined
        },
      ),
    )
  ).findLast((value) => value !== undefined)
  if (configured) return { backend: "reddb" as const, location: validateURL(configured), source: "config" as const }
  return {
    backend: "sqlite" as const,
    location: path(),
    source: Flag.REDCODE_DB ? ("environment" as const) : ("default" as const),
  }
}

export function validateURL(value: string) {
  const url = new URL(value)
  if (
    !["red:", "reds:", "grpc:", "grpcs:", "http:", "https:", "ws:", "wss:", "red+ws:", "red+wss:"].includes(
      url.protocol,
    )
  )
    throw new Error(`Unsupported REDCODE_DATABASE_URL protocol: ${url.protocol}`)
  if (url.username || url.password || url.search || url.hash)
    throw new Error("REDCODE_DATABASE_URL must not contain credentials, query parameters or fragments")
  return value
}

const selectedLayer = Layer.unwrap(
  Effect.promise(selection).pipe(
    Effect.map((selected) =>
      selected.backend === "reddb"
        ? layerFromURL(selected.location, Flag.REDCODE_DATABASE_TOKEN)
        : layerFromPath(selected.location),
    ),
  ),
)

export const node = makeGlobalNode({ service: Service, layer: selectedLayer, deps: [] })
