export * as CreatorPluginProbe from "./plugin-probe.js"

import { CreatorPlugin } from "@opencode/schema/creator-plugin"
import { AppProcess } from "@opencode/util/process"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { cp, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ChildProcess } from "effect/unstable/process"

const make = Effect.gen(function* () {
  const processes = yield* AppProcess.Service
  return {
    run: (directory: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "redcode-plugin-test-"))),
            (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
          )
          // A test gets a disposable copy, fresh storage and no configured connections.
          yield* Effect.promise(() => cp(directory, path.join(temporary, "package"), { recursive: true }))
          const runtime = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase()
          const command =
            runtime === "bun"
              ? [process.execPath, fileURLToPath(new URL("../../../cli/src/index.ts", import.meta.url))]
              : [process.execPath]
          const result = yield* processes.run(
            ChildProcess.make(command[0]!, [...command.slice(1), "--internal-creator-plugin-probe", temporary], {
              cwd: temporary,
              env: {
                PATH: process.env.PATH ?? "",
                SystemRoot: process.env.SystemRoot ?? "",
                TEMP: temporary,
                TMP: temporary,
                HOME: temporary,
                USERPROFILE: temporary,
                XDG_CONFIG_HOME: temporary,
                XDG_DATA_HOME: temporary,
                XDG_CACHE_HOME: temporary,
                XDG_STATE_HOME: temporary,
                REDCODE_TEST_HOME: temporary,
                OPENCODE_TEST_HOME: temporary,
              },
              extendEnv: false,
            }),
            { timeout: "45 seconds", maxOutputBytes: 16384, maxErrorBytes: 16384 },
          )
          const report = yield* Effect.tryPromise(() => Bun.file(path.join(temporary, "report.json")).json()).pipe(
            Effect.option,
          )
          if (report._tag === "Some") return yield* Schema.decodeUnknownEffect(CreatorPlugin.Report)(report.value)
          return {
            passed: false,
            time: Date.now(),
            tools: [],
            message: `Plugin test exited with code ${result.exitCode}. ${result.stderr.toString().slice(-8000)}`,
          }
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed({
            passed: false,
            time: Date.now(),
            tools: [],
            message: `Plugin test failed: ${String(cause).slice(0, 8000)}`,
          }),
        ),
      ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/CreatorPluginProbe") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [AppProcess.node] })
