import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { ServerProcess } from "../../src/process"

export const startServer = Effect.fnUntraced(function* (directory: string, hostname = "127.0.0.1") {
  const server = yield* ServerProcess.start<never, never>({
    hostname,
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    config: { directory },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return {
    base: HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1"),
    headers: { authorization: `Basic ${btoa("opencode:secret")}` },
  }
})
