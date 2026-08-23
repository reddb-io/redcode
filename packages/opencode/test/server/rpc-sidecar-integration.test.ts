import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../lib/cli-process"

const sidecar = path.resolve(import.meta.dir, "../../../rpc-sidecar/src/cli.ts")

cliIt.live(
  "RPC sidecar authenticates to the real server",
  ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* opencode.serve({ env: { OPENCODE_SERVER_PASSWORD: "secret" } })
      const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: {}, id: 1 })
      const proc = Bun.spawn(["bun", sidecar], {
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: "secret",
          REDCODE_AUTHORIZATION: "",
          REDCODE_RPC_URL: `${server.url}/rpc`,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      proc.stdin.end()

      const [exitCode, stdout, stderr] = yield* Effect.promise(() =>
        Promise.all([proc.exited, new Response(proc.stdout).bytes(), new Response(proc.stderr).text()]),
      )
      expect(exitCode, stderr).toBe(0)
      const boundary = Buffer.from(stdout).indexOf("\r\n\r\n")
      expect(boundary).toBeGreaterThan(0)
      expect(JSON.parse(new TextDecoder().decode(stdout.slice(boundary + 4)))).toEqual({
        jsonrpc: "2.0",
        result: { healthy: true },
        id: 1,
      })
    }),
  60_000,
)
