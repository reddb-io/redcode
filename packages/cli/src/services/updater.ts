import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { RetainedImage } from "./retained-image"
import { action, parseReleaseVersion, type Policy } from "./updater-action"
import { errorMessage } from "../util/error"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew", "mise"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }

// red-dev installs Redcode through mise's GitHub backend, which unpacks each release
// under <MISE_DATA_DIR>/installs/github-reddb-io-redcode/<version>/.
const MISE_TOOL = "github:reddb-io/redcode"
const MISE_INSTALL_DIR = "github-reddb-io-redcode"
const RELEASES_URL = "https://github.com/reddb-io/redcode/releases"

export class UpgradeError extends Error {
  readonly title: string
  readonly detail: string
  readonly command?: string
  readonly retry: string

  constructor(
    input: {
      readonly title: string
      readonly detail: string
      readonly command?: string
      readonly retry: string
    },
    options?: ErrorOptions,
  ) {
    super(input.detail, options)
    this.name = "UpgradeError"
    this.title = input.title
    this.detail = input.detail
    this.command = input.command
    this.retry = input.retry
  }
}

const decodeVpPackages = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String }))),
)

const decodeMiseVersions = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ version: Schema.String, active: Schema.optional(Schema.Boolean) })),
  ),
)

const decodeGitHubRelease = Schema.decodeUnknownOption(Schema.Struct({ tag_name: Schema.String }))

const installNames: Record<Method, string> = {
  curl: "The OpenCode installer",
  npm: "npm",
  pnpm: "pnpm",
  bun: "Bun",
  yarn: "Yarn",
  vp: "Vite+",
  brew: "Homebrew",
  mise: "mise",
}

function conciseDetail(input: string) {
  const lines = stripVTControlCharacters(input)
    .trim()
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const tail = lines.slice(-12).join("\n")
  const clipped = tail.length > 2_000
  const detail = clipped ? `…${tail.slice(-1_999)}` : tail
  if (!detail) return
  if (lines.length <= 12 && !clipped) return detail
  return `${detail}\n\nOutput shortened to the last 12 lines.`
}

function errorDetail(cause: unknown): string {
  if (cause instanceof AppProcess.AppProcessError) {
    const stderr = conciseDetail(cause.stderr ?? "")
    if (stderr) return stderr
    if (cause.cause !== undefined) return errorDetail(cause.cause)
    return cause.message
  }
  if (cause instanceof Error) {
    const detail = cause.cause === undefined ? undefined : errorDetail(cause.cause)
    if (!detail || detail === cause.message) return cause.message
    return `${cause.message}: ${detail}`
  }
  return errorMessage(cause)
}

function resultDetail(result: { code: number; stdout: string; stderr: string }) {
  return (
    conciseDetail(result.stderr) ??
    conciseDetail(result.stdout) ??
    `The command exited with code ${result.code} without any error output.`
  )
}

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined, Error>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: () => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const redcode = OPENCODE_ARTIFACT === "redcode"
  const product = redcode ? "Redcode" : "OpenCode"
  const commandName = redcode ? "redcode" : "opencode"
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const installedVersion = yield* Ref.make(OPENCODE_VERSION)
  const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  const installedPackage = yield* Effect.gen(function* () {
    const executable = yield* fs.realPath(process.execPath)
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    // Source invocations run inside Bun or Node, which may themselves be npm packages.
    if (redcode && /^@reddb-io\/redcode-(?:linux|darwin|windows)-/.test(manifest.name)) return "@reddb-io/redcode"
    if (redcode ? manifest.name !== "@reddb-io/redcode" : !/^@opencode(?:-ai)?\/cli(?:-node)?$/.test(manifest.name))
      return
    if (Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable))
      return manifest.name
  }).pipe(Effect.orElseSucceed(() => undefined))

  const readPolicy = Effect.fnUntraced(function* () {
    // Same names and precedence as the global config loader: Redcode names override OpenCode names.
    const names = ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"]
    const values = yield* Effect.forEach(names, (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "notify"
  })

  const exec = Effect.fnUntraced(function* (command: string[], timeout: Duration.Input = "10 seconds") {
    return yield* appProcess
      .run(ChildProcess.make(command[0], command.slice(1)), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        })),
      )
  })

  const curlBinary = path.resolve(
    global.home,
    ".opencode",
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  )

  const method = Effect.fnUntraced(function* () {
    if (path.resolve(process.execPath) === curlBinary) return "curl"
    const executable = yield* fs.realPath(process.execPath).pipe(Effect.orElseSucceed(() => process.execPath))
    // Match Redcode's own mise install directory, not any mise install: Bun or Node may come from mise too.
    if (executable.toLowerCase().includes(`${path.sep}installs${path.sep}${MISE_INSTALL_DIR}${path.sep}`)) return "mise"
    if (
      ["opencode-beta", "opencode-v2"].some((name) =>
        executable.includes(`${path.sep}Cellar${path.sep}${name}${path.sep}`),
      )
    )
      return "brew"
    if (!installedPackage) return

    const checks: ReadonlyArray<{ method: Method; command: string[] }> = [
      { method: "npm", command: ["npm", "list", "-g", "--depth=0", installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
      { method: "vp", command: ["vp", "list", "-g", "--json", installedPackage] },
    ]
    const results = yield* Effect.forEach(
      checks,
      (check) =>
        exec(check.command).pipe(
          Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
          Effect.map((result) => ({ check, result })),
        ),
      { concurrency: "unbounded" },
    )
    return results.find((result) => {
      if (result.check.method !== "vp") return result.result.stdout.includes(installedPackage)
      // Vite+ repeats the filter in its successful no-match message, so substring detection would be a false positive.
      return Option.exists(decodeVpPackages(result.result.stdout), (packages) =>
        packages.some((item) => item.name === installedPackage),
      )
    })?.check.method
  })

  const removal = (method: Method) => {
    if (method === "curl" || method === "brew" || method === "mise" || !installedPackage) return undefined
    const commands = {
      npm: ["npm", "uninstall", "--global", installedPackage],
      pnpm: ["pnpm", "remove", "--global", installedPackage],
      bun: ["bun", "remove", "--global", installedPackage],
      yarn: ["yarn", "global", "remove", installedPackage],
      vp: ["vp", "uninstall", "-g", installedPackage],
    }
    const command = commands[method]
    return {
      command,
      run: retaining(
        method,
        exec(command, "5 minutes").pipe(
          Effect.flatMap((result) => (result.code === 0 ? Effect.void : Effect.fail(new Error(resultDetail(result))))),
        ),
        global.tmp,
      ),
    }
  }

  const release = Effect.fnUntraced(function* (method?: Method) {
    const distribution = method === "brew" ? "homebrew" : "npm"
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(
          // mise installs GitHub release assets, so it follows the GitHub latest release, not npm.
          method === "mise"
            ? "https://api.github.com/repos/reddb-io/redcode/releases/latest"
            : redcode
              ? "https://registry.npmjs.org/@reddb-io%2fredcode/dist-tags"
              : `https://opencode.ai/update/api/${encodeURIComponent(channel)}/${encodeURIComponent(OPENCODE_ARTIFACT)}/${distribution}?current=${encodeURIComponent(OPENCODE_VERSION)}`,
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          },
        ),
      catch: (cause) =>
        new UpgradeError(
          {
            title: `Could not check for ${product} updates`,
            detail: errorDetail(cause),
            retry: `Check your network, then run ${commandName} upgrade again.`,
          },
          { cause },
        ),
    })
    if (!response.ok)
      return yield* Effect.fail(
        new UpgradeError({
          title: `Could not check for ${product} updates`,
          detail: `The update service returned HTTP ${response.status}.`,
          retry: "Try again in a few minutes.",
        }),
      )
    const data: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new UpgradeError(
          {
            title: `Could not read the ${product} update information`,
            detail: errorDetail(cause),
            retry: "Try again in a few minutes.",
          },
          { cause },
        ),
    })
    if (method === "mise") {
      const tag = decodeGitHubRelease(data)
      if (Option.isSome(tag) && parseReleaseVersion(tag.value.tag_name))
        return { package: MISE_TOOL, version: tag.value.tag_name.replace(/^v/, "") }
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not read the Redcode update information",
          detail: "The latest reddb-io/redcode GitHub release has no version tag.",
          retry: `Check ${RELEASES_URL} and try again.`,
        }),
      )
    }
    if (redcode) {
      const tags = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))(data)
      const version = Option.isSome(tags) ? (tags.value[channel] ?? tags.value.latest) : undefined
      if (version) return { package: "@reddb-io/redcode", version }
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not read the Redcode update information",
          detail: `The npm registry has no ${channel} Redcode version.`,
          retry: "Check the published npm dist-tags and try again.",
        }),
      )
    }
    const info = Schema.decodeUnknownOption(
      Schema.Struct({ version: Schema.String, metadata: Schema.Struct({ package: Schema.String }) }),
    )(data)
    if (Option.isNone(info))
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not read the OpenCode update information",
          detail: "The update service returned incomplete release information.",
          retry: "Try again in a few minutes.",
        }),
      )
    return { package: info.value.metadata.package, version: info.value.version }
  })

  const latest = () =>
    method().pipe(
      Effect.flatMap(release),
      Effect.map((data) => data.version),
    )

  const temporaryDirectory = (prefix: string) =>
    Effect.acquireRelease(fs.makeTempDirectory({ directory: global.cache, prefix }), (directory) =>
      fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
    )

  // On Windows the installer must delete or replace the running binary, which only works
  // while another link to it exists (see RetainedImage). Upgrades keep that link in the
  // cache; uninstall has already removed the cache, so it uses the temporary directory.
  const retaining = <A, E, R>(method: Method, effect: Effect.Effect<A, E, R>, directory = global.cache) => {
    if (process.platform !== "win32" || method === "brew") return effect
    // Only the installed binary is at stake; source checkouts run inside bun or node.
    const owned = method === "curl" ? path.resolve(process.execPath) === curlBinary : installedPackage !== undefined
    if (!owned) return effect
    return Effect.scoped(RetainedImage.retain(directory, "upgrade").pipe(Effect.andThen(effect))).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    )
  }

  const runUpgrade = (input: {
    readonly method: Method
    readonly command: string[]
    readonly displayCommand?: string[]
    readonly title?: string
    readonly retry?: string
  }) => {
    const failure = (detail: string, cause?: unknown) =>
      new UpgradeError(
        {
          title: input.title ?? `${installNames[input.method]} could not install ${product}`,
          detail,
          command: (input.displayCommand ?? input.command).join(" "),
          retry: input.retry ?? `Fix the issue above, then run ${commandName} upgrade again.`,
        },
        cause === undefined ? undefined : { cause },
      )
    return exec(input.command, "5 minutes").pipe(
      Effect.flatMap((result) =>
        result.code === 0 ? Effect.succeed(result) : Effect.fail(failure(resultDetail(result))),
      ),
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : failure(
              cause instanceof AppProcess.AppProcessError && cause.stderr === undefined && cause.cause === undefined
                ? `Failed to update with ${input.method}`
                : errorDetail(cause),
              cause,
            ),
      ),
    )
  }

  // mise keeps every version it fetched; the shim runs only the active one.
  const miseInstall = (version: string) =>
    exec(["mise", "ls", "--json", MISE_TOOL]).pipe(
      Effect.map((result) =>
        Option.getOrUndefined(decodeMiseVersions(result.stdout))?.find((item) => item.version === version),
      ),
      Effect.orElseSucceed(() => undefined),
    )

  const upgradeMise = Effect.fnUntraced(function* (version: string) {
    // A stale cached version list makes `mise upgrade` see nothing new; clearing it is best-effort.
    yield* exec(["mise", "cache", "clear", MISE_TOOL]).pipe(Effect.ignore)
    // `--bump` moves an exact pin such as red-dev's; a plain upgrade stays inside the pinned range and exits 0.
    yield* runUpgrade({ method: "mise", command: ["mise", "upgrade", "--bump", MISE_TOOL] })
    // `--bump` lands on the newest version mise is willing to see, which its own gates can hold
    // below the offered one. Select the offered version by name so the accepted update is what runs.
    const selection = (yield* miseInstall(version))?.active
      ? undefined
      : yield* exec(["mise", "use", "-g", `${MISE_TOOL}@${version}`], "5 minutes").pipe(
          Effect.orElseSucceed(() => undefined),
        )
    // mise exits 0 when it keeps the old version, so only an active target proves the update.
    const installed = yield* miseInstall(version)
    if (installed?.active) return
    const title = `mise could not switch ${product} to v${version}`
    if (installed)
      return yield* Effect.fail(
        new UpgradeError({
          title,
          detail: `mise installed v${version} but still selects another version, so ${commandName} keeps running the old one.`,
          command: `mise use -g ${MISE_TOOL}@${version}`,
          retry: "Run the command above, then open a new shell.",
        }),
      )
    const offered = (yield* exec(["mise", "ls-remote", MISE_TOOL], "30 seconds").pipe(
      Effect.map((result) => result.stdout),
      Effect.orElseSucceed(() => ""),
    ))
      .split("\n")
      .map((line) => line.trim())
      .includes(version)
    if (offered)
      return yield* Effect.fail(
        new UpgradeError({
          title,
          detail: selection && selection.code !== 0 ? resultDetail(selection) : `mise did not install v${version}.`,
          command: `mise use -g ${MISE_TOOL}@${version}`,
          retry: `Fix the issue above, then run ${commandName} upgrade again.`,
        }),
      )
    return yield* Effect.fail(
      new UpgradeError({
        title,
        detail: [
          `mise does not offer v${version} yet: it holds back releases younger than its minimum_release_age setting.`,
          `Releases are listed at ${RELEASES_URL}.`,
        ].join("\n"),
        command: `mise settings add minimum_release_age_excludes "${MISE_TOOL}"`,
        retry: `Run the command above to let ${product} releases through while keeping the delay for other tools, then run ${commandName} upgrade again.`,
      }),
    )
  })

  const upgrade = Effect.fnUntraced(function* (method: Method, input: string) {
    if (!parseReleaseVersion(input)) return yield* Effect.fail(new Error(`Invalid version: ${input}`))
    if (redcode && (method === "curl" || method === "brew"))
      return yield* Effect.fail(
        new UpgradeError({
          title: "Redcode cannot update through this installer",
          detail: `${method} is not a Redcode release channel in this build.`,
          retry: `Install @reddb-io/redcode with npm, Bun, pnpm, Yarn, or Vite+, or ${MISE_TOOL} with mise, and rerun ${commandName} upgrade.`,
        }),
      )
    const version = input.trim().replace(/^v/, "")
    if (method === "mise") return yield* upgradeMise(version)
    const packageName = (yield* release(method)).package
    const target = `${packageName}@${version}`
    if (installedPackage && packageName !== installedPackage && (method === "pnpm" || method === "yarn")) {
      return yield* Effect.fail(new Error(`Reinstall ${target} with ${method} to migrate from ${installedPackage}.`))
    }
    const commands: Record<Exclude<Method, "bun" | "curl" | "brew" | "mise">, string[]> = {
      // Keep the old package: uninstalling it can unlink the replacement command.
      npm: [
        "npm",
        "install",
        "--global",
        ...((OPENCODE_ARTIFACT === "cli" && !installedPackage?.endsWith("/cli-node")) ||
        (installedPackage && packageName !== installedPackage)
          ? ["--force"]
          : []),
        target,
      ],
      pnpm: ["pnpm", "add", "--global", `--allow-build=${packageName}`, target],
      yarn: ["yarn", "global", "add", target],
      vp:
        installedPackage && packageName !== installedPackage
          ? ["vp", "install", "-g", "--force", target]
          : ["vp", "update", "-g", target],
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        if (method === "bun") {
          // Bun does not prune old versions from its shared package cache.
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const cache = yield* temporaryDirectory("update-")
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: ["bun", "install", "--global", "--trust", "--cache-dir", cache, target],
              displayCommand: ["bun", "install", "--global", "--trust", target],
            }),
          )
        }
        if (method === "curl") {
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const directory = yield* temporaryDirectory("update-")
          const installer = path.join(directory, "install")
          yield* runUpgrade({
            method,
            command: ["curl", "-fsSL", "-o", installer, "https://opencode.ai/v2/install"],
            displayCommand: ["curl", "-fsSL", "https://opencode.ai/v2/install"],
            title: "Could not download the OpenCode installer",
            retry: "Check your network, then run opencode upgrade again.",
          })
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: ["bash", installer, "--version", version, "--no-modify-path"],
              displayCommand: ["opencode", "upgrade", version, "--method", "curl"],
              title: "The OpenCode installer failed",
            }),
          )
        }
        if (method === "brew") return yield* runUpgrade({ method, command: ["brew", "upgrade", packageName] })
        return yield* retaining(method, runUpgrade({ method, command: commands[method] }))
      }),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : new UpgradeError(
              {
                title: `Could not prepare the ${product} upgrade`,
                detail: errorDetail(cause),
                retry: `Fix the issue above, then run ${commandName} upgrade again.`,
              },
              { cause },
            ),
      ),
      Effect.asVoid,
    )
  })

  const inspect = Effect.fnUntraced(function* () {
    if (OPENCODE_LOCAL || ["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: OPENCODE_LOCAL ? "local-install" : "disabled",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      })
      return undefined
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return undefined
    }

    const current = yield* Ref.get(installedVersion)
    const version = yield* latest()
    yield* Effect.logInfo("update check", {
      current,
      latest: version,
    })
    const next = action(current, version, policy)
    if (next === "none") {
      yield* Effect.logInfo("update check done", { action: "up-to-date" })
      return undefined
    }
    yield* Effect.logInfo(`${product} update available`, { current, latest: version, action: next })
    return { policy, version }
  })

  const install = Effect.fnUntraced(function* (version: string) {
    const detected = yield* method()
    if (!detected) {
      yield* Effect.logWarning("update skipped: installation method not found")
      return false
    }
    const current = yield* Ref.get(installedVersion)
    yield* upgrade(detected, version)
    yield* Ref.set(installedVersion, version)
    yield* Effect.logInfo(`updated ${product}`, { from: current, to: version, method: detected })
    return true
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    if (!(yield* install(version))) return yield* Effect.fail(new Error("Installation method not found"))
  })

  const check = Effect.fn("cli.updater.check")(function* () {
    if (OPENCODE_LOCAL)
      return {
        type: "unavailable" as const,
        message: `This build runs from a source checkout. Use an installed ${product} release to check for updates.`,
      }
    const version = yield* latest()
    if (!parseReleaseVersion(version)) return yield* Effect.fail(new Error(`Invalid version: ${version}`))
    const current = yield* Ref.get(installedVersion)
    if (action(current, version, "auto") === "none") {
      // An earlier check may have installed the update while this client is still running.
      return action(OPENCODE_VERSION, current, "auto") === "none"
        ? undefined
        : { type: "installed" as const, version: current }
    }
    return { type: "available" as const, version }
  })

  const run = Effect.fn("cli.updater.run")(
    function* (onInstall: (version: string) => void = () => {}) {
      const result = yield* inspect()
      if (!result) return undefined
      if (result.policy === "notify") return { type: "available" as const, version: result.version }
      onInstall(result.version)
      if (!(yield* install(result.version))) return yield* Effect.fail(new Error("Installation method not found"))
      return { type: "installed" as const, version: result.version }
    },
    Effect.catch((error) => Effect.logWarning("update check failed", { error }).pipe(Effect.as(undefined))),
  )

  return Service.of({ run, check, apply, method, latest, upgrade, removal })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
