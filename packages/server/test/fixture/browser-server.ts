import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import { Cause, Effect, Exit } from "effect"
import { Global } from "@opencode/util/global"
import { ServerFetch } from "../../src/fetch"
import { OwnedPaths } from "../../src/owned-paths"

const options = parseArgs({ options: { port: { type: "string" }, dist: { type: "string" } } }).values
const assets = path.resolve(options.dist ?? "dist")
if (!(await Bun.file(path.join(assets, "index.html")).exists()))
  throw new Error("Build the app before running browser contracts")
const signal = new AbortController()
process.once("SIGTERM", () => signal.abort())
process.once("SIGINT", () => signal.abort())

const result = await Effect.runPromiseExit(
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "redcode-browser-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const handler = yield* ServerFetch.make(
        {
          app: { name: "redcode", version: "browser-contract", channel: "test" },
          database: { path: ":memory:" },
          config: { directory: root, global: false, project: false },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
          events: { persist: true },
        },
        {
          overrides: [
            Global.node.replace(
              Global.layerWith({
                home: root,
                data: path.join(root, "data"),
                config: path.join(root, "config"),
                state: path.join(root, "state"),
                cache: path.join(root, "cache"),
                tmp: path.join(root, "tmp"),
                bin: path.join(root, "bin"),
                log: path.join(root, "log"),
                repos: path.join(root, "repos"),
              }),
            ),
          ],
        },
      )
      const response = yield* Effect.promise(() =>
        handler(
          new Request("http://fixture/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Browser contract session", location: { directory: root } }),
          }),
        ),
      )
      if (!response.ok) return yield* Effect.die(new Error(`Session fixture failed: ${response.status}`))
      const fixture = yield* Effect.promise(() => response.json())
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: Number(options.port ?? 4779),
        async fetch(request) {
          const pathname = new URL(request.url).pathname
          if (pathname === "/__fixture")
            return Response.json({ sessionID: fixture.data.id, directory: root, title: fixture.data.title })
          if (OwnedPaths.owned(pathname)) return handler(request)
          const file = Bun.file(path.join(assets, pathname))
          return new Response((await file.exists()) ? file : Bun.file(path.join(assets, "index.html")))
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      process.stdout.write(`Browser contract server: ${server.url}\n`)
      yield* Effect.never
    }),
  ),
  { signal: signal.signal },
)
if (Exit.isFailure(result) && !Cause.hasInterruptsOnly(result.cause)) throw Cause.squash(result.cause)
