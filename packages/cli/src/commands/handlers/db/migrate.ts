import { EOL } from "node:os"
import { existsSync } from "node:fs"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { databasePath } from "../../../database-path"

export default Runtime.handler(
  Commands.commands.db.commands.migrate,
  Effect.fn("cli.db.migrate")(function* (input) {
    const global = yield* Global.Service
    const source = databasePath(global.data)
    if (source === ":memory:" || !existsSync(source))
      return yield* Effect.fail(new Error(`SQLite source database does not exist: ${source}`))
    const { migrateToRedDB } = yield* Effect.promise(() => import("@opencode/core/database/migrate-reddb"))
    const result = yield* Effect.promise(() =>
      migrateToRedDB(source, Database.validateURL(input.to), process.env.REDCODE_DATABASE_TOKEN),
    )
    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  }),
)
