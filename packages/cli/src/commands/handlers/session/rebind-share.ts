import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, request } from "../auth/shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(Commands.commands.session.commands["rebind-share"], (input) =>
  Effect.gen(function* () {
    const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
    const session = yield* request((signal) =>
      client.session.rebindShare(
        { sessionID: input.sessionID, credentialID: input.credentialID, orgID: input.orgID },
        { signal },
      ),
    )
    process.stdout.write(`Rebound and synchronized ${session.share?.url ?? input.sessionID}` + EOL)
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
