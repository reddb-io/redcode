import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.db.commands["export-redcode"],
  Effect.fn("cli.db.export-redcode")(function* (input) {
    const global = yield* Global.Service
    const selected = yield* Effect.promise(() => select(global))
    const url = selected.url
    if (!url) return yield* Effect.fail(new Error("Select a V1 RedDB database to export"))
    const { exportRedcode } = yield* Effect.promise(() => import("@opencode/core/database/export-reddb"))
    const result = yield* Effect.promise(() =>
      exportRedcode(url, path.resolve(input.to), selected.token),
    )
    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  }),
)
