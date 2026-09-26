import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.generate,
  Effect.fn("cli.generate")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const document = yield* Effect.tryPromise(async () => {
      const response = await fetch(new URL("/openapi.json", server.endpoint.url), {
        headers: Service.headers(server.endpoint),
      })
      if (!response.ok) throw new Error(`Failed to load OpenAPI document: HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    })
    process.stdout.write(JSON.stringify(document, null, 2) + "\n")
  }),
)
