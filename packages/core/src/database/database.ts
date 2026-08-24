export * as Database from "./database"

import { EffectDrizzleSqlite } from "@reddb-io/redcode-effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { existsSync } from "fs"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
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

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
