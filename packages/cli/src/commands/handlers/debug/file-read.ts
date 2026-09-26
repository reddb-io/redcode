import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { FSUtil } from "@opencode/util/fs-util"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.debug.commands.file.commands.read,
  Effect.fn("cli.debug.file.read")(function* (args) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const content = yield* Effect.promise(() => client.file.read({ location: { directory: process.cwd() }, path: args.path }))
    process.stdout.write(JSON.stringify({
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
      mime: FSUtil.mimeType(args.path),
    }, null, 2) + EOL)
  }),
)
