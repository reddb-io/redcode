import { EOL } from "node:os"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.db.commands.status,
  Effect.fn("cli.db.status")(function* () {
    const global = yield* Global.Service
    const selected = yield* Effect.promise(() => select(global))
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.db.all(sql`SELECT 1 AS ok`)
    }).pipe(Effect.provide(Database.layer(selected)))
    process.stdout.write(
      JSON.stringify({ backend: selected.url ? "reddb" : "sqlite", location: selected.url ?? selected.path, connected: true }, null, 2) + EOL,
    )
  }),
)
