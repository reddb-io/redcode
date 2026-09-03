import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { httpClient } from "@reddb-io/redcode-core/effect/app-node-platform"
import { Effect, Layer, Schema, Context } from "effect"
import { serviceUse } from "@reddb-io/redcode-core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@reddb-io/redcode-core/process"
import { makeRuntime } from "@reddb-io/redcode-core/effect/runtime"
import path from "path"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@reddb-io/redcode-core/installation/version"
import { NpmConfig } from "@reddb-io/redcode-core/npm-config"
import { InstallationEvent } from "@reddb-io/redcode-schema/installation-event"

export type Method = "npm" | "yarn" | "pnpm" | "bun" | "mise" | "unknown"

// red-dev installs Redcode through mise's GitHub backend, which unpacks the release
// binary under <MISE_DATA_DIR>/installs/github-reddb-io-redcode/<version>/.
export const MISE_TOOL = "github:reddb-io/redcode"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `redcode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// Response schemas for external version APIs
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
const NpmPackage = Schema.Struct({ version: Schema.String })

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
    const appProcess = yield* AppProcess.Service

    const text = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return result.stdout.toString("utf8")
      },
      Effect.catch(() => Effect.succeed("")),
    )

    const run = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.catch((err) => Effect.succeed({ code: 1, stdout: "", stderr: errorMessage(err) })),
    )

    const upgradeFailure = (method: Method, result?: { code: number; stdout: string; stderr: string }) => {
      if (result) return `Upgrade failed for ${method} (exit code ${result.code}).`
      return `Upgrade failed for ${method}.`
    }

    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        const exec = process.execPath.toLowerCase()
        if (exec.includes(path.join("mise", "installs").toLowerCase())) return "mise" as Method

        const checks: Array<{ name: Method; command: () => Effect.Effect<string>; installed: (output: string) => boolean }> =
          [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]), installed: hasPackage },
            { name: "yarn", command: () => text(["yarn", "global", "list"]), installed: hasPackage },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]), installed: hasPackage },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]), installed: hasPackage },
            // `mise ls --json <tool>` prints `[]` when mise knows nothing about the tool.
            { name: "mise", command: () => text(["mise", "ls", "--json", MISE_TOOL]), installed: hasMiseVersion },
          ]

        checks.sort((a, b) => {
          const aMatches = exec.includes(a.name)
          const bMatches = exec.includes(b.name)
          if (aMatches && !bMatches) return -1
          if (!aMatches && bMatches) return 1
          return 0
        })

        for (const check of checks) {
          const output = yield* check.command()
          if (check.installed(output)) return check.name
        }

        return "unknown" as Method
      }),
      latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
        const detectedMethod = installMethod || (yield* result.method())

        if (
          detectedMethod === "npm" ||
          detectedMethod === "bun" ||
          detectedMethod === "pnpm" ||
          detectedMethod === "yarn"
        ) {
          const response = yield* httpOk.execute(
            HttpClientRequest.get(
              `${yield* NpmConfig.registry(process.cwd())}/@reddb-io%2Fredcode/${InstallationChannel}`,
            ).pipe(HttpClientRequest.acceptJson),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
          return data.version
        }

        const response = yield* httpOk.execute(
          HttpClientRequest.get("https://api.github.com/repos/reddb-io/redcode/releases/latest").pipe(
            HttpClientRequest.acceptJson,
          ),
        )
        const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
        return data.tag_name.replace(/^v/, "")
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
        let upgradeResult: { code: number; stdout: string; stderr: string } | undefined
        switch (m) {
          case "npm":
            upgradeResult = yield* run(["npm", "install", "-g", `@reddb-io/redcode@${target}`])
            break
          case "pnpm":
            upgradeResult = yield* run(["pnpm", "install", "-g", `@reddb-io/redcode@${target}`])
            break
          case "bun":
            upgradeResult = yield* run(["bun", "install", "-g", `@reddb-io/redcode@${target}`])
            break
          case "yarn":
            upgradeResult = yield* run(["yarn", "global", "add", `@reddb-io/redcode@${target}`])
            break
          case "mise":
            // mise caches the remote version list; with a stale list `mise upgrade` decides there is
            // nothing to do. Clearing it is best-effort, the upgrade below is what matters.
            yield* run(["mise", "cache", "clear", MISE_TOOL])
            upgradeResult = yield* run(["mise", "upgrade", MISE_TOOL])
            break
          default:
            return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}` })
        }
        if (!upgradeResult || upgradeResult.code !== 0) {
          return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, upgradeResult) })
        }
        // `mise upgrade` exits 0 when it keeps the pinned version, so confirm the target landed.
        if (m === "mise" && !hasMiseVersion(yield* text(["mise", "ls", "--json", MISE_TOOL]), target)) {
          return yield* new UpgradeFailedError({
            stderr: `mise did not install v${target}. Run "mise use -g ${MISE_TOOL}@latest" and try again.`,
          })
        }
        yield* Effect.logInfo("upgraded", {
          method: m,
          target,
          stdout: upgradeResult.stdout,
          stderr: upgradeResult.stderr,
        })
        yield* text([process.execPath, "--version"])
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient, AppProcess.node] })

function hasPackage(output: string) {
  return output.includes("@reddb-io/redcode")
}

function hasMiseVersion(output: string, version?: string) {
  try {
    const parsed: unknown = JSON.parse(output)
    if (!Array.isArray(parsed)) return false
    const versions = parsed.flatMap((item) =>
      item && typeof item === "object" && typeof (item as { version?: unknown }).version === "string"
        ? [(item as { version: string }).version]
        : [],
    )
    return version === undefined ? versions.length > 0 : versions.includes(version)
  } catch {
    return false
  }
}

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
