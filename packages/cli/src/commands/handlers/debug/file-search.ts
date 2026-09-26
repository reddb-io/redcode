import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.file.commands.search,
  Effect.fn("cli.debug.file.search")(function* (args) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const result = yield* Effect.promise(() => client.file.find({ location: { directory: process.cwd() }, query: args.query }))
    process.stdout.write(result.data.map((item) => item.path).join(EOL) + EOL)
  }),
)
