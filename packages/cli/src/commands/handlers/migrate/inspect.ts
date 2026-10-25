import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { FileConversion } from "../../../migration/file"

export default Runtime.handler(
  Commands.commands.migrate.commands.inspect,
  Effect.fn("cli.migrate.inspect")(function* (input) {
    const result = yield* Effect.tryPromise(() => FileConversion.inspect(input.source, input.kind))
    process.stdout.write(
      input.json
        ? JSON.stringify(result) + "\n"
        : [
            `Source: ${result.source}`,
            `Format: ${result.current ? "current" : "requires conversion"}`,
            `Compatible: ${result.compatible ? "yes" : "no"}`,
            ...result.diagnostics.map((item) => `${item.kind}: ${item.path.join(".")}: ${item.message}`),
            "",
          ].join("\n"),
    )
  }),
)
