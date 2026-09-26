import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.rg.commands.search,
  Effect.fn("cli.debug.rg.search")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const matches = (yield* Effect.promise(() => client.debug.rg.search({
      location: { directory: process.cwd() },
      pattern: input.pattern,
      glob: input.glob[0],
      limit: input.limit,
    }))).data
    process.stdout.write(JSON.stringify(matches, null, 2) + EOL)
  }),
)
