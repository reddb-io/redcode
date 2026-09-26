import { EOL } from "node:os"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { databasePath } from "../../../database-path"

export default Runtime.handler(
  Commands.commands.usage.commands.path,
  Effect.fn("cli.usage.path")(function* () {
    const global = yield* Global.Service
    process.stdout.write(databasePath(global.data) + EOL)
  }),
)
