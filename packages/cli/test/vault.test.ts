import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { describe, expect, test } from "bun:test"
import { Effect, Exit, FileSystem, Option, Scope } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import importVault from "../src/commands/handlers/vault/import"
import setVault from "../src/commands/handlers/vault/set"
import { callVault, importSummary, pipedValue } from "../src/commands/handlers/vault/shared"
import { OPENCODE_VERSION } from "../src/version"

// Assembled from parts so no secret scanner mistakes the fixture for a real credential.
const value = "ghp" + "_" + "a".repeat(36)

describe("vault command output", () => {
  test("drops only the trailing line break of a piped value", () => {
    expect(pipedValue(value + "\n")).toBe(value)
    expect(pipedValue(value + "\r\n")).toBe(value)
    expect(pipedValue(value + "\n\n")).toBe(value + "\n")
    expect(pipedValue(" " + value)).toBe(" " + value)
    expect(pipedValue("\n")).toBe("")
    expect(pipedValue(value + "\r")).toBe(value + "\r")
    expect(pipedValue("first\nsecond\n")).toBe("first\nsecond")
  })

  test("lists the stored references and the skipped lines", () => {
    expect(importSummary({ names: ["github-token", "db-password"], skipped: 2 })).toEqual([
      "Imported 2 secrets: {vault:github-token}, {vault:db-password}",
      "Skipped 2 lines",
    ])
    expect(importSummary({ names: ["github-token"], skipped: 1 })).toEqual([
      "Imported 1 secret: {vault:github-token}",
      "Skipped 1 line",
    ])
    expect(importSummary({ names: [], skipped: 0 })).toEqual(["Imported 0 secrets"])
    expect(importSummary({ names: [], skipped: 3 })).toEqual(["Imported 0 secrets", "Skipped 3 lines"])
  })

  test("says an unreadable file imported nothing, whatever else the result holds", () => {
    expect(importSummary({ names: [], skipped: 0, unreadable: true })).toEqual([
      "The file could not be read; nothing was imported.",
    ])
    expect(importSummary({ names: ["github-token"], skipped: 0, unreadable: false })).toEqual([
      "Imported 1 secret: {vault:github-token}",
    ])
  })
})

/**
 * A loopback server that answers the health check the CLI makes before an explicit `--server` call and records
 * every vault RPC it receives, replying with `reply(method)`.
 */
async function withServer(
  reply: (method: string) => Response,
  run: (input: {
    readonly url: string
    readonly requests: ReadonlyArray<{ readonly path: string; readonly body: unknown }>
    readonly runPromise: <A, E>(
      effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>,
    ) => Promise<A>
  }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-cli-vault-"))
  const requests: Array<{ readonly path: string; readonly body: unknown }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info") return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] })
      const body: unknown = await request.json()
      requests.push({ path: url.pathname, body })
      return reply(url.pathname.split("/").at(-1) ?? "")
    },
  })
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))
  try {
    await run({ url: server.url.toString(), requests, runPromise })
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
}

describe("vault commands against a server", () => {
  test("set sends the name and value to the vault RPC and returns only the stored name", () =>
    withServer(
      () => Response.json({ output: "github-token" }),
      async (fixture) => {
        const output = await fixture.runPromise(
          callVault({ server: fixture.url, method: "set", input: { name: "GITHUB_TOKEN", value } }),
        )
        expect(output).toBe("github-token")
        expect(fixture.requests).toEqual([
          { path: "/api/rpc/redcode.vault/set", body: { input: { name: "GITHUB_TOKEN", value } } },
        ])
      },
    ))

  test("import sends only the resolved path, so the file's values never pass through the CLI", () =>
    withServer(
      () => Response.json({ output: { names: ["github-token"], skipped: 1 } }),
      async (fixture) => {
        await fixture.runPromise(importVault({ server: Option.some(fixture.url), file: "secrets.env" }))
        expect(fixture.requests).toEqual([
          { path: "/api/rpc/redcode.vault/import", body: { input: { path: path.resolve("secrets.env") } } },
        ])
      },
    ))

  test("import fails on a response that is not an import result", () =>
    withServer(
      () => Response.json({ output: { names: "github-token" } }),
      async (fixture) => {
        const exit = await fixture.runPromise(
          Effect.exit(importVault({ server: Option.some(fixture.url), file: "secrets.env" })),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      },
    ))

  test("a server error fails the call without echoing the value", () =>
    withServer(
      () => Response.json({ message: "vault unavailable" }, { status: 500 }),
      async (fixture) => {
        const exit = await fixture.runPromise(
          Effect.exit(callVault({ server: fixture.url, method: "set", input: { name: "GITHUB_TOKEN", value } })),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(Exit.isFailure(exit) ? exit.cause : "")).not.toContain(value)
      },
    ))

  test("set reads a piped value, sends it once and prints only the reference", () =>
    withServer(
      () => Response.json({ output: "github-token" }),
      async (fixture) => {
        const { printed } = await withStdin(value + "\n", () =>
          fixture.runPromise(setVault({ server: Option.some(fixture.url), name: "GITHUB_TOKEN" })),
        )
        expect(fixture.requests).toEqual([
          { path: "/api/rpc/redcode.vault/set", body: { input: { name: "GITHUB_TOKEN", value } } },
        ])
        expect(printed).toBe("Stored {vault:github-token}" + os.EOL)
        expect(printed).not.toContain(value)
      },
    ))

  test("set refuses an empty piped value before calling the server", () =>
    withServer(
      () => Response.json({ output: "github-token" }),
      async (fixture) => {
        // The handler reports a failure by setting the exit code rather than by failing.
        process.exitCode = undefined
        await withStdin("\n", () =>
          fixture.runPromise(setVault({ server: Option.some(fixture.url), name: "GITHUB_TOKEN" })),
        )
        const code = process.exitCode
        process.exitCode = undefined
        expect(code).toBe(1)
        expect(fixture.requests).toEqual([])
      },
    ))
})

/** Runs `run` with `text` piped to stdin and returns its result with what it wrote to stdout. */
async function withStdin<A>(text: string, run: () => Promise<A>) {
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin")
  const write = process.stdout.write
  const written: string[] = []
  Object.defineProperty(process, "stdin", { value: Readable.from([text]), configurable: true })
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    const result = await run()
    return { result, printed: written.join("") }
  } finally {
    process.stdout.write = write
    if (stdin) Object.defineProperty(process, "stdin", stdin)
  }
}
