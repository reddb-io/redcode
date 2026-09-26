import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(Commands.commands.github.commands.run, (input) =>
  Effect.gen(function* () {
    const server = yield* ServerConnection.resolve({ standalone: true })
    const { runGithub } = yield* Effect.promise(() => import("../../../github/run"))
    yield* Effect.promise(() =>
      runGithub({
        client: OpenCode.make({
          baseUrl: server.endpoint.url,
          headers: Service.headers(server.endpoint),
          fetch: ((request: RequestInfo | URL, init?: RequestInit) =>
            fetch(request, { ...init, timeout: false } as BunFetchRequestInit)) as typeof fetch,
        }),
        event: Option.getOrUndefined(input.event),
        token: Option.getOrUndefined(input.token),
      }),
    )
  }),
)
