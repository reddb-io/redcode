import { EOL } from "node:os"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { openUrl } from "../../ui/prompt"

export default Runtime.handler(
  Commands.commands.design,
  Effect.fn("cli.design")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
      mismatch: "ignore",
    })
    const response = yield* Effect.tryPromise(() =>
      fetch(new URL(`/design/session/${encodeURIComponent(input.sessionID)}/link`, server.endpoint.url), {
        headers: Service.headers(server.endpoint),
      }),
    )
    if (!response.ok)
      return yield* Effect.fail(
        new Error(`Unable to open Design review for ${input.sessionID}: HTTP ${response.status} ${response.statusText}`),
      )
    const link = yield* Effect.tryPromise(() => response.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))),
    )
    process.stdout.write(link.url + EOL)
    if (!input.noOpen && process.stdin.isTTY && process.stdout.isTTY) yield* openUrl(link.url)
  }),
)
