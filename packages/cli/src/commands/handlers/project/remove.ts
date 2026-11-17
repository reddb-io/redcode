import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.project.remove")(function* (
  input: Runtime.Input<typeof Commands.commands.project.commands.remove>,
) {
  if (!input.yes) {
    process.stdout.write(
      `Removing project ${input.projectID} hides it from the project list. Pass --yes to confirm.${EOL}`,
    )
    return
  }
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  yield* Effect.tryPromise({
    try: (signal) => client.project.remove({ projectID: input.projectID }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Project ${input.projectID} removed${EOL}`)
})

export default Runtime.handler(Commands.commands.project.commands.remove, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
