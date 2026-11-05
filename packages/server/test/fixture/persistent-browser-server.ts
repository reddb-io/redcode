// Isolated server for the Windows desktop/web terminal integration test.
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ServerProcess } from "../../src/process"

const root = await mkdtemp(path.join(tmpdir(), "redcode-terminal-e2e-"))
process.env.OPENCODE_PTY_RUNTIME_DIR = path.join(root, "runtime")
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* ServerProcess.start({
          hostname: "127.0.0.1",
          port: 0,
          password: "test-only",
          database: { path: path.join(root, "state.db") },
          models: { fetch: false },
          config: { global: false, project: false, content: "{}" },
          fs: { filewatcher: false, fff: false },
        })
        const base = HttpServer.formatAddress(server.address)
        process.stdout.write(`FIXTURE_READY ${base}\n`)
        yield* Effect.promise(() => new Promise<void>((resolve) => process.stdin.once("end", resolve).resume()))
        yield* Effect.promise(() =>
          fetch(`${base}/api/experimental/persistent-pty/shutdown`, {
            method: "POST",
            headers: { authorization: `Basic ${btoa("opencode:test-only")}` },
          }).then(() => undefined),
        ).pipe(Effect.ignore)
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
