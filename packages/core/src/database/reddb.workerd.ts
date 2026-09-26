export * as RedDBBackend from "./reddb.workerd.js"

import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import type { Options } from "./reddb.js"

export const layer = (_options: Options) =>
  Layer.effect(SqlClient.SqlClient, Effect.die(new Error("Remote RedDB is unavailable in workerd")))
