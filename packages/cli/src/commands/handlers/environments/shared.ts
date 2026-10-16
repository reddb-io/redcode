import { Effect, Option } from "effect"
import { OpenCode } from "@opencode/client/promise"
import { Service } from "@opencode/client/effect/service"
import { ServerConnection } from "../../../services/server-connection"

export const client = Effect.fn("cli.environments.client")(function* (server: Option.Option<string>) {
  const connection = yield* ServerConnection.resolve({ server: Option.getOrUndefined(server), mismatch: "ignore" })
  return OpenCode.make({ baseUrl: connection.endpoint.url, headers: Service.headers(connection.endpoint) })
    .projectEnvironments
})
