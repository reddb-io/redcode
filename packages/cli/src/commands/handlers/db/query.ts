import { EOL } from "node:os"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.db.commands.query,
  Effect.fn("cli.db.query")(function* (input) {
    const global = yield* Global.Service
    const selected = yield* Effect.promise(() => select(global))
    if (Option.isNone(input.sql)) {
      if (!selected.path || selected.path === ":memory:")
        return yield* Effect.fail(new Error("The interactive database shell requires a SQLite database"))
      const child = Bun.spawn(["sqlite3", selected.path], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
      const code = yield* Effect.promise(() => child.exited)
      if (code !== 0) return yield* Effect.fail(new Error(`sqlite3 exited with code ${code}`))
      return
    }
    const result = yield* Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database.db.all<Record<string, unknown>>(sql.raw(input.sql.value))
    }).pipe(Effect.provide(Database.layer(selected)))
    if (input.format === "json") {
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
      return
    }
    if (result.length === 0) return
    const keys = Object.keys(result[0])
    process.stdout.write(keys.join("\t") + EOL)
    result.forEach((row) => process.stdout.write(keys.map((key) => String(row[key] ?? "")).join("\t") + EOL))
  }),
)
