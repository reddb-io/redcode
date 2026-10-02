import { EOL } from "os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const options = yield* ServiceConfig.options()
    const transport = yield* ServerConnection.restart(options)
    process.stdout.write(transport.url + EOL)
  }),
)
