import { EOL } from "node:os"
import { OpenCode, type ConfigEntry } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { designBrowser } from "@opencode/util/open"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { openUrl } from "../../ui/prompt"
import { selfCommand } from "../../util/process"

export default Runtime.handler(
  Commands.commands.design,
  Effect.fn("cli.design")(function* (input) {
    const prompt = input.prompt.join(" ").trim()
    const existing = Option.getOrUndefined(input.session)
    const review = input.review || (input.prompt.length === 1 && /^ses_[A-Za-z0-9]/.test(prompt) && !existing)
    if (!review) {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        return yield* Effect.fail(new Error("Design sessions require an interactive terminal"))
      const directory = Option.getOrUndefined(input.directory)
      const model = Option.getOrUndefined(input.model)
      const server = Option.getOrUndefined(input.server)
      const child = Bun.spawn(
        [
          ...selfCommand(),
          "--agent", "design",
          ...(prompt ? ["--prompt", prompt] : []),
          ...(existing ? ["--session", existing] : []),
          ...(model ? ["--model", model] : []),
          ...(server ? ["--server", server] : []),
          ...(input.standalone ? ["--standalone"] : []),
          ...(directory ? [directory] : []),
        ],
        { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
      )
      const exitCode = yield* Effect.promise(() => child.exited)
      if (exitCode !== 0) return yield* Effect.fail(new Error(`Design session exited with status ${exitCode}`))
      return
    }
    const sessionID = existing ?? prompt
    if (!sessionID) return yield* Effect.fail(new Error("Provide a Session ID to open its Design review"))
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
      mismatch: "ignore",
    })
    const response = yield* Effect.tryPromise(() =>
      fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}/link`, server.endpoint.url), {
        headers: Service.headers(server.endpoint),
      }),
    )
    if (!response.ok)
      return yield* Effect.fail(
        new Error(`Unable to open Design review for ${sessionID}: HTTP ${response.status} ${response.statusText}`),
      )
    const link = yield* Effect.tryPromise(() => response.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))),
    )
    process.stdout.write(link.url + EOL)
    if (input.noOpen || !process.stdin.isTTY || !process.stdout.isTTY) return
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const entries = yield* Effect.tryPromise(() => client.config.get({ location: { directory: process.cwd() } })).pipe(
      Effect.orElseSucceed((): ConfigEntry[] => []),
    )
    const configured = entries
      .filter((entry): entry is Extract<ConfigEntry, { type: "document" }> => entry.type === "document")
      .findLast((entry) => typeof entry.info.design?.browser === "string")?.info.design?.browser
    yield* openUrl(link.url, { browser: designBrowser(configured) })
  }),
)
