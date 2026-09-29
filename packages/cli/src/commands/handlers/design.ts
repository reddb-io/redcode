import { EOL } from "node:os"
import { log } from "@clack/prompts"
import { OpenCode, type ConfigEntry } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { configuredDesignBrowser } from "@opencode/tui/util/design-browser"
import { openDesignReview } from "@opencode/util/design-review"
import { browserDisabled, NO_BROWSER, openDesignUrl } from "@opencode/util/open"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { selfCommand } from "../../util/process"

export default Runtime.handler(
  Commands.commands.design,
  Effect.fn("cli.design")(function* (input) {
    const prompt = input.prompt.join(" ").trim()
    const existing = Option.getOrUndefined(input.session)
    const review = input.review || (input.prompt.length === 1 && /^ses_[A-Za-z0-9]/.test(prompt) && !existing)
    const target = Option.getOrUndefined(input.target)
    const platform = Option.getOrUndefined(input.platform)
    if (platform && target !== "app") return yield* Effect.fail(new Error("--platform applies only with --target app"))
    if (target && review)
      return yield* Effect.fail(new Error("--target applies to new designs; it cannot be combined with a review"))
    if (!review) {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        return yield* Effect.fail(new Error("Design sessions require an interactive terminal"))
      const directory = Option.getOrUndefined(input.directory)
      const model = Option.getOrUndefined(input.model)
      const server = Option.getOrUndefined(input.server)
      // The server reads a forced target from its environment (DesignTarget.forced), so the session gets a
      // private server that inherits it; the background service and remote servers keep their own.
      if (target && server)
        return yield* Effect.fail(new Error("--target needs the Design session's own server; it cannot be combined with --server"))
      const child = Bun.spawn(
        [
          ...selfCommand(),
          "--agent", "design",
          ...(prompt ? ["--prompt", prompt] : []),
          ...(existing ? ["--session", existing] : []),
          ...(model ? ["--model", model] : []),
          ...(server ? ["--server", server] : []),
          ...(input.standalone || target ? ["--standalone"] : []),
          ...(directory ? [directory] : []),
        ],
        {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: target
            ? { ...process.env, REDCODE_DESIGN_TARGET: target, REDCODE_DESIGN_PLATFORM: platform }
            : process.env,
        },
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
    // The printed link stays the command's output; the launch claims through the server like the TUI and app.
    const notice = yield* Effect.tryPromise(() =>
      openDesignReview({
        sessionID,
        endpoint: { url: server.endpoint.url, headers: Service.headers(server.endpoint) },
        explicit: true,
        disabledBy: browserDisabled() ? NO_BROWSER : undefined,
        launch: (url) => openDesignUrl(url, { configured: configuredDesignBrowser(entries) }),
      }),
    )
    if (notice?.variant === "error") log.error(notice.message)
    if (notice?.variant === "info") log.info(notice.message)
  }),
)
