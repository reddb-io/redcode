import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.session.archive")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.archive>,
) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  yield* Effect.tryPromise({
    try: (signal) => client.session.archive({ sessionID: input.sessionID, archived: !input.restore }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Session ${input.sessionID} ${input.restore ? "restored" : "archived"}${EOL}`)
})

export default Runtime.handler(Commands.commands.session.commands.archive, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
