import { describe, expect } from "bun:test"
import { makeGlobalNode } from "@reddb-io/redcode-core/effect/app-node"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { httpClient } from "@reddb-io/redcode-core/effect/app-node-platform"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel } from "@reddb-io/redcode-core/installation/version"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string },
) {
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: mockSpawner(spawnHandler),
    deps: [],
  })
  return LayerNode.compile(Installation.node, [
    [httpClient, mockHttpClient(httpHandler)],
    [CrossSpawnSpawner.node, spawnerNode],
  ])
}

describe("installation", () => {
  describe("latest", () => {
    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("4.0.0-beta.1")
        }),
    )

    const npmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        npmCalls.push(request.url)
        return jsonResponse({ version: "1.5.0" })
      }),
    ).effect("reads npm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("npm")
        expect(result).toBe("1.5.0")
        expect(npmCalls).toContain(`https://registry.npmjs.org/@reddb-io%2Fredcode/${InstallationChannel}`)
      }),
    )

    const bunCalls: string[] = []
    testEffect(
      testLayer((request) => {
        bunCalls.push(request.url)
        return jsonResponse({ version: "1.6.0" })
      }),
    ).effect("reads bun versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("bun")
        expect(result).toBe("1.6.0")
        expect(bunCalls).toContain(`https://registry.npmjs.org/@reddb-io%2Fredcode/${InstallationChannel}`)
      }),
    )

    const pnpmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        pnpmCalls.push(request.url)
        return jsonResponse({ version: "1.7.0" })
      }),
    ).effect("reads pnpm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("pnpm")
        expect(result).toBe("1.7.0")
        expect(pnpmCalls).toContain(`https://registry.npmjs.org/@reddb-io%2Fredcode/${InstallationChannel}`)
      }),
    )
  })

  describe("method", () => {
    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd === "mise" && args[0] === "ls")
            return JSON.stringify([{ version: "1.0.0", install_path: "/home/u/.local/share/mise/installs/x/1.0.0" }])
          return ""
        },
      ),
    ).effect("detects a mise-managed install from mise ls", () =>
      Effect.gen(function* () {
        expect(yield* Installation.use.method()).toBe("mise")
      }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => (cmd === "mise" && args[0] === "ls" ? "[]" : ""),
      ),
    ).effect("stays unknown when mise does not know the tool", () =>
      Effect.gen(function* () {
        expect(yield* Installation.use.method()).toBe("unknown")
      }),
    )
  })

  describe("upgrade", () => {
    const miseCalls: string[][] = []
    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          miseCalls.push([cmd, ...args])
          if (cmd === "mise" && args[0] === "ls") return JSON.stringify([{ version: "9.9.9" }])
          return ""
        },
      ),
    ).effect("upgrades a mise install and confirms the target version", () =>
      Effect.gen(function* () {
        yield* Installation.use.upgrade("mise", "9.9.9")
        expect(miseCalls).toContainEqual(["mise", "cache", "clear", Installation.MISE_TOOL])
        expect(miseCalls).toContainEqual(["mise", "upgrade", Installation.MISE_TOOL])
        expect(miseCalls).toContainEqual(["mise", "ls", "--json", Installation.MISE_TOOL])
      }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => (cmd === "mise" && args[0] === "ls" ? JSON.stringify([{ version: "1.0.0" }]) : ""),
      ),
    ).effect("fails when mise keeps the old version after upgrading", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("mise", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toContain("did not install v9.9.9")
      }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd) => {
          if (cmd === "npm") return { code: 1, stderr: "token=secret command output" }
          return ""
        },
      ),
    ).effect("returns sanitized typed errors for failed package upgrades", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("Upgrade failed for npm (exit code 1).")
        expect(error.message).toBe(error.stderr)
        expect(error.stderr).not.toContain("secret")
        expect(error.stderr).not.toContain("command output")
      }),
    )
  })
})
