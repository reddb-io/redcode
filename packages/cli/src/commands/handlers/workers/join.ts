import { cancel, isCancel, text } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { parseInvitation } from "../../../workers/enrollment"

export default Runtime.handler(
  Commands.commands.workers.commands.join,
  Effect.fn("cli.workers.join")(function* (input) {
    const invitation = yield* Effect.try(() => parseInvitation(input.invitation))
    if ((!Option.isSome(input.url) || !Option.isSome(input.directory)) && !process.stdin.isTTY)
      return yield* Effect.fail(new Error("Non-interactive enrollment requires --url and --directory"))
    const config = yield* ServiceConfig.read()
    if (config.disabled) return yield* Effect.fail(new Error("Enable the background service before enrolling a worker"))
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    if (!endpoint.auth?.password)
      return yield* Effect.fail(new Error("Worker enrollment requires an authenticated server"))
    const local = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const info = yield* Effect.tryPromise(() => local.server.info())
    const suggested = info.urls.find(
      (value) => !["127.0.0.1", "localhost", "[::1]", "0.0.0.0", "[::]"].includes(new URL(value).hostname),
    )
    const address = Option.isSome(input.url)
      ? input.url.value
      : yield* Effect.promise(() =>
          text({
            message: "Worker URL reachable from the coordinator (LAN, VPN or HTTPS)",
            ...(suggested ? { initialValue: suggested } : {}),
            validate: (value) => {
              const url = URL.parse(value ?? "")
              return !url ||
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password ||
                url.search ||
                url.hash
                ? "Enter an HTTP or HTTPS worker URL without credentials"
                : undefined
            },
          }),
        )
    if (isCancel(address)) {
      cancel("Worker enrollment cancelled")
      return
    }
    const directory = Option.isSome(input.directory)
      ? input.directory.value
      : yield* Effect.promise(() =>
          text({
            message: "Project directory on this worker",
            initialValue: process.cwd(),
            validate: (value) => (value?.trim() ? undefined : "Enter a project directory"),
          }),
        )
    if (isCancel(directory)) {
      cancel("Worker enrollment cancelled")
      return
    }
    const location = yield* Effect.tryPromise(() => local.location.get({ location: { directory } }))
    const coordinator = OpenCode.make({ baseUrl: invitation.coordinator })
    const result = yield* Effect.tryPromise(() =>
      coordinator.workers.enroll({
        code: invitation.code,
        url: address,
        password: endpoint.auth!.password,
        directories: [location.directory],
      }),
    )
    process.stdout.write(
      `Worker ${result.worker.id} registered with ${invitation.coordinator}. It is now available in the coordinator's worker list.\n`,
    )
  }),
)
