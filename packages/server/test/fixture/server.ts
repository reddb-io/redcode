import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { ServerProcess } from "../../src/process"
import path from "node:path"

export const startServer = Effect.fnUntraced(function* (directory: string, hostname = "127.0.0.1") {
  // Load only fixture-authored global settings. Ambient user MCPs can hold Windows checkout directories open.
  const file = path.join(directory, "opencode.json")
  yield* Effect.promise(async () => {
    if (!(await Bun.file(file).exists())) await Bun.write(file, "{}")
  })
  const server = yield* ServerProcess.start<never, never>({
    hostname,
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    config: { directory, global: false, file },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return {
    base: HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1"),
    headers: { authorization: `Basic ${btoa("opencode:secret")}` },
  }
})
