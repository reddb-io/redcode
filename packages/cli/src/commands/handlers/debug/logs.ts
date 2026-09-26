import { EOL } from "node:os"
import { Effect } from "effect"
import { Logging } from "@opencode/util/observability/logging"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { OPENCODE_CHANNEL } from "../../../version"

export default Runtime.handler(
  Commands.commands.debug.commands.logs,
  Effect.fn("cli.debug.logs")(function* (input) {
    if (input.path && input.open) return yield* Effect.fail(new Error("--path and --open cannot be combined"))
    const file = Logging.file(OPENCODE_CHANNEL === "local", OPENCODE_CHANNEL)
    if (input.open) {
      const { openPath } = yield* Effect.promise(() => import("@opencode/util/open"))
      yield* Effect.tryPromise({
        try: () => openPath(file),
        catch: (cause) => new Error(`Cannot open diagnostic log: ${String(cause)}`),
      })
    }
    process.stdout.write(file + EOL)
  }),
)
