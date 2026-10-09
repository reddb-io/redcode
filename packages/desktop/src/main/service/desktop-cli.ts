export * as DesktopCli from "./desktop-cli"

import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { BUNDLED_CLI_VERSION_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { parseCliVersion } from "./cli-version"

const execFileAsync = promisify(execFile)

export interface Resolved {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
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

    const resolve = yield* Effect.cached(
      make().pipe(Effect.provide(yield* Effect.context<FileSystem.FileSystem | Path.Path>()), Effect.orDie),
    )

    // Links ~/.local/bin/redcode to the executable inside the app bundle, whose path survives app updates.
    // Staged copies are not linked: each version stages its own and older ones are removed.
    const install = Effect.gen(function* () {
      if (process.platform !== "darwin") return yield* Effect.fail(new Error("CLI installation requires macOS"))
      if (!app.isPackaged) return yield* Effect.fail(new Error("Bundled CLI executable is unavailable"))
      const fs = yield* FileSystem.FileSystem
      const directory = path.join(app.getPath("home"), ".local", "bin")
      const destination = path.join(directory, executableName())
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.remove(destination, { force: true })
      yield* fs.symlink(path.join(process.resourcesPath, executableName()), destination)

      return destination
    }).pipe(
      Effect.provide(yield* Effect.context<FileSystem.FileSystem>()),
      Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
    )

    return Service.of({ resolve, install })
  }),
)

const make = Effect.fn("DesktopCli.resolve")(function* () {
  // Development runs the `redcode` on PATH, or the executable named by REDCODE_BIN.
  if (!app.isPackaged) {
    const binary = process.env.REDCODE_BIN ?? executableName()
    const version = parseCliVersion(yield* run(binary, ["--version"]).pipe(Effect.orElseSucceed(() => "local")))

    return { version, binary, command: [binary] } satisfies Resolved
  }

  return yield* resolveBundledCli()
})

const resolveBundledCli = Effect.fn("DesktopCli.resolveBundled")(function* () {
  const path = yield* Path.Path
  const bundled = path.join(process.resourcesPath, executableName())

  yield* Effect.logInfo("CLI executable resolved", { bundled })
  const version = yield* bundledVersion(bundled)
  const binary = yield* installCli(bundled, version)

  return { version, binary, command: [binary] } satisfies Resolved
})

// Spawning the bundled executable for `--version` costs ~400 ms of startup on a 200 MB binary (and
// several seconds on the first launch after an update, while the antivirus scans it). The build
// writes the version next to the executable, so a packaged app never spawns; the per-identity cache
// covers executables that arrived without that file.
const bundledVersion = Effect.fn("DesktopCli.bundledVersion")(function* (bundled: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  // Synchronous on purpose: this sits on the path to the first window's IPC port, and a queued
  // async read waits behind everything else the main thread is doing at that moment.
  const shipped = yield* Effect.sync(() => {
    try {
      return readFileSync(path.join(path.dirname(bundled), "redcode.version"), "utf8").trim()
    } catch {
      return ""
    }
  })

  if (shipped) {
    yield* Effect.logInfo("CLI version bundled", { version: shipped })

    return shipped
  }

  const stat = yield* fs.stat(bundled).pipe(Effect.orElseSucceed(() => undefined))
  const identity = stat ? `${stat.size}:${Option.getOrUndefined(stat.mtime)?.getTime() ?? ""}` : undefined
  const store = getStore()
  const cached = Option.getOrUndefined(Schema.decodeUnknownOption(VersionCache)(store.get(BUNDLED_CLI_VERSION_KEY)))

  if (identity && cached?.path === bundled && cached.identity === identity) {
    yield* Effect.logInfo("CLI version reused", { version: cached.version })

    return cached.version
  }

  const version = parseCliVersion(yield* run(bundled, ["--version"]))

  if (identity)
    store.set(BUNDLED_CLI_VERSION_KEY, { path: bundled, identity, version } satisfies typeof VersionCache.Type)

  return version
})

const VersionCache = Schema.Struct({ path: Schema.String, identity: Schema.String, version: Schema.String })

const ExecFailure = Schema.Struct({ stdout: Schema.optional(Schema.String), stderr: Schema.optional(Schema.String) })

const installCli = Effect.fn("DesktopCli.install")(function* (source: string, version: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = path.join(directory, executableName())

  if (existsSync(destination)) {
    yield* Effect.logInfo("CLI staged executable reused", { path: destination, version })

    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  yield* fs.makeDirectory(directory, { recursive: true })
  yield* fs.copyFile(source, temp)

  if (process.platform !== "win32") yield* fs.chmod(temp, 0o755)
  yield* fs
    .rename(temp, destination)
    .pipe(Effect.catch((error) => fs.remove(temp, { force: true }).pipe(Effect.andThen(Effect.fail(error)))))
  yield* Effect.logInfo("CLI executable staged", { source, path: destination, version })

  return destination
})

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
