import { EOL } from "node:os"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.db.commands.path,
  Effect.fn("cli.db.path")(function* () {
    const global = yield* Global.Service
    const database = yield* Effect.promise(() => select(global))
    process.stdout.write((database.url ?? database.path ?? ":memory:") + EOL)
  }),
)
