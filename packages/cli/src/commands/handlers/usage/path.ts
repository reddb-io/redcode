import { EOL } from "node:os"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { databasePath } from "../../../database-path"
import { UsagePath } from "@opencode/core/usage/path"

export default Runtime.handler(
  Commands.commands.usage.commands.path,
  Effect.fn("cli.usage.path")(function* (input) {
    const global = yield* Global.Service
    process.stdout.write((input.v2 ? databasePath(global.data) : UsagePath.sidecar(global.home)) + EOL)
  }),
)
