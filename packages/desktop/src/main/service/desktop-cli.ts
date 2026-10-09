export * as DesktopCli from "./desktop-cli"

import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { type CliLocation, locateCli } from "./cli-location"
import { parseCliVersion } from "./cli-version"
import { desktopInstallFile } from "./registration"

const execFileAsync = promisify(execFile)

export interface Resolved {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
  readonly source: CliLocation["source"]
}

export interface Interface {
  readonly resolve: Effect.Effect<Resolved>
  readonly install: Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopCli") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path

    // Lazy: test runs point REDCODE_TEST_HOME, and with it the pointer file, elsewhere during startup.
    const location = yield* Effect.cached(
      Effect.sync(() =>
        locateCli({
          env: process.env,
          platform: process.platform,
          resourcesPath: process.resourcesPath,
          execPath: process.execPath,
          version: app.getVersion(),
          pointer: desktopInstallFile(),
          exists: existsSync,
          read: (file) => (existsSync(file) ? readFileSync(file, "utf8") : undefined),
        }),
      ),
    )

    const resolve = yield* Effect.cached(
      location.pipe(
        Effect.flatMap(make),
        Effect.provide(yield* Effect.context<FileSystem.FileSystem | Path.Path>()),
        Effect.orDie,
      ),
    )

    // Links ~/.local/bin/redcode to the resolved executable of this app's installation.
    const install = Effect.gen(function* () {
      if (process.platform !== "darwin") return yield* Effect.fail(new Error("CLI installation requires macOS"))
      const cli = yield* location

      if (cli.source === "development") return yield* Effect.fail(new Error("Installed CLI executable is unavailable"))
      const fs = yield* FileSystem.FileSystem
      const directory = path.join(app.getPath("home"), ".local", "bin")
      const destination = path.join(directory, executableName())
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.remove(destination, { force: true })
      yield* fs.symlink(cli.binary, destination)

      return destination
    }).pipe(
      Effect.provide(yield* Effect.context<FileSystem.FileSystem>()),
      Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
    )

    return Service.of({ resolve, install })
  }),
)

const make = Effect.fn("DesktopCli.resolve")(function* (location: CliLocation) {
  yield* Effect.logInfo("CLI executable resolved", location)

  // Development runs the executable named by REDCODE_BIN, or the `redcode` on PATH.
  const version =
    location.source === "development"
      ? parseCliVersion(yield* run(location.binary, ["--version"]).pipe(Effect.orElseSucceed(() => "local")))
      : location.version

  return { version, binary: location.binary, command: [location.binary], source: location.source } satisfies Resolved
})

const ExecFailure = Schema.Struct({ stdout: Schema.optional(Schema.String), stderr: Schema.optional(Schema.String) })

const run = Effect.fn("DesktopCli.run")(function* (binary: string, args: string[]) {
  yield* Effect.logInfo("CLI command started", { binary, args })

  const result = yield* Effect.tryPromise(() => execFileAsync(binary, args, { windowsHide: true })).pipe(
    Effect.tapError((error) => {
      const output = Option.getOrUndefined(Schema.decodeUnknownOption(ExecFailure)(error.cause))

      return Effect.logError("CLI command failed", {
        args,
        error: error.cause instanceof Error ? error.cause.message : String(error.cause),
        stdout: output?.stdout?.trim() ?? "",
        stderr: output?.stderr?.trim() ?? "",
      })
    }),
  )

  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  yield* Effect.logInfo("CLI command completed", { args, stdout, stderr })

  return stdout
})

function executableName() {
  return process.platform === "win32" ? "redcode.exe" : "redcode"
}
