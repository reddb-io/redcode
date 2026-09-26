import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, request } from "../auth/shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(Commands.commands.usage.commands.backfill, (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const result = yield* request((signal) => client.session.usage.backfill({ signal }))
    process.stdout.write(`Mirrored ${result.mirrored} assistant messages; skipped ${result.skipped}. ${result.sidecar}${EOL}`)
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
