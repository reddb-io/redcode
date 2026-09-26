import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.skill,
  Effect.fn("cli.debug.skill")(function* () {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const result = yield* Effect.promise(() => client.skill.list({ location: { directory: process.cwd() } }))
    process.stdout.write(JSON.stringify(result.data, null, 2) + EOL)
  }),
)
