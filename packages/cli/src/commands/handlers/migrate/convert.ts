import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { FileConversion } from "../../../migration/file"

export default Runtime.handler(
  Commands.commands.migrate.commands.convert,
  Effect.fn("cli.migrate.convert")(function* (input) {
    const result = yield* Effect.tryPromise(() => FileConversion.convert(input.source, input.output, input.kind))
    process.stdout.write(JSON.stringify(result) + "\n")
  }),
)
