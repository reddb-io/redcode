// Isolated integration fixture: a real foreground server with network model discovery disabled.
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { ServerProcess } from "../../src/process"

const database = process.argv[2]
if (!database) throw new Error("A test database path is required")
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* ServerProcess.start({
        hostname: "127.0.0.1",
        port: 0,
        password: "fixture-only",
        database: { path: database },
        models: { fetch: false },
        config: { global: false, project: false, content: "{}" },
        fs: { filewatcher: false, fff: false },
      })
      yield* Effect.never
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
)
