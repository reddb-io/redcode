import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.file.commands.list,
  Effect.fn("cli.debug.file.list")(function* (args) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const result = yield* Effect.promise(() => client.file.list({ location: { directory: process.cwd() }, path: args.path }))
    process.stdout.write(JSON.stringify(result.data, null, 2) + EOL)
  }),
)
