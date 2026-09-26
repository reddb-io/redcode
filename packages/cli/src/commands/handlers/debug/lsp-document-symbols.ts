import { EOL } from "os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { fileURLToPath } from "node:url"

export default Runtime.handler(
  Commands.commands.debug.commands.lsp.commands["document-symbols"],
  Effect.fn("cli.debug.lsp.document-symbols")(function* (args) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const result = yield* Effect.promise(() => client.lsp.documentSymbols({
      location: { directory: process.cwd() },
      path: args.file.startsWith("file:") ? fileURLToPath(args.file) : args.file,
    }))
    process.stdout.write(JSON.stringify(result.data, null, 2) + EOL)
  }),
)
