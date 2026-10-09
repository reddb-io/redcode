import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages } from "./cli-stages"
import { DesktopCli } from "./desktop-cli"
import { SidecarCredentials } from "./sidecar-credentials"
import { serviceRegistrationFile } from "./registration"
import { sidecarProbe } from "./sidecar-probe"

const execFileAsync = promisify(execFile)

export * as BackgroundService from "./background-service"

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()

    return Service.of(
      yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: connect("reconnect").pipe(Effect.provide(context), Effect.orDie),
      }),
    )
  }),
)

const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  const override = process.env.REDCODE_DESKTOP_SERVER_URL

  if (override) {
    const url = new URL(override)
    yield* Effect.logInfo("background service override in use", endpoint(url.origin))
    const ready = {
      url: url.origin,
      password: process.env.REDCODE_DESKTOP_SERVER_PASSWORD ?? null,
    } satisfies SidecarCredentials.Data
    SidecarCredentials.set(ready)

    return ready
  }

  yield* Effect.logInfo("starting background service", { mode })
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>())
  const cli = yield* desktopCli.resolve
  const file = serviceRegistrationFile()
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  // A service the entry module already found is adopted at once. Otherwise `redcode service start` starts
  // (or joins) the service, so the CLI's own channel, configuration and environment rules apply exactly as
  // they do for the terminal client; the registration then supplies the private credential.
  const early = mode === "initial" ? yield* Effect.promise(sidecarProbe) : undefined
  const service =
    early ??
    (yield* Effect.gen(function* () {
      yield* startService(cli.command)

      return yield* Effect.promise(() => client.Service.discover({ file }))
    }))

  if (!service) throw new Error(`Redcode background service did not register in ${file}`)
  if (service.auth?.type !== "basic") throw new Error("Redcode background service did not provide authentication")
  const url = new URL(service.url)

  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("background service ready", { version: cli.version, probed: !!early, ...endpoint(url.origin) })

  // Only packaged builds run a staged copy; the service now runs from the current stage, so an older copy at
  // most belongs to a process still exiting.
  if (mode === "initial" && app.isPackaged && cli.binary)
    runFork(
      cleanStages(cli.binary).pipe(Effect.catch((error) => Effect.logError("failed to clean staged CLIs", { error }))),
    )
  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)

  return ready
})

const startService = Effect.fn("BackgroundService.start")(function* (command: readonly string[]) {
  const [binary, ...args] = command

  if (!binary) return yield* Effect.die(new Error("Missing CLI command"))
  yield* Effect.logInfo("CLI command started", { binary, args: [...args, "service", "start"] })
  const result = yield* Effect.tryPromise(() =>
    execFileAsync(binary, [...args, "service", "start"], { windowsHide: true, timeout: 60_000 }),
  ).pipe(
    Effect.tapError((error) => Effect.logError("CLI command failed", { args: ["service", "start"], error: error.cause })),
    Effect.orDie,
  )
  yield* Effect.logInfo("CLI command completed", { stdout: result.stdout.trim() })
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)

  return { url, hostname: parsed.hostname, port: parsed.port }
}
