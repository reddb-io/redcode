import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.rg.commands.files,
  Effect.fn("cli.debug.rg.files")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const files = (yield* Effect.promise(() => client.debug.rg.files({
      location: { directory: process.cwd() },
      glob: Option.getOrUndefined(input.glob),
      query: Option.getOrUndefined(input.query),
      limit: input.limit,
    })))
    process.stdout.write(files.map((file) => file.path).join(EOL) + EOL)
  }),
)
