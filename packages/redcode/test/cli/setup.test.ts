import { describe, expect } from "bun:test"
import { Deferred, Effect, Queue } from "effect"
import path from "node:path"
import { cliIt, isolatedEnv, withCliFixture } from "../lib/cli-process"
import { it } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"

const interactive = process.platform === "win32" ? it.live.skip : it.live

describe("redcode setup", () => {
  cliIt.live("requires a terminal without booting a project when input is piped", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["setup", "--verbose"])
      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("Interactive setup requires a terminal")
      expect(result.stderr).not.toContain("InstanceRef not provided")
      expect(result.stderr).not.toContain("instance.boot")
    }),
  )

  // The existing native PTY implementation is exercised on Linux; Windows cannot open this PTY.
  interactive(
    "reaches S2 and S1 selection in a real terminal and preserves settings when cancelled",
    () =>
      withCliFixture(
        ({ home, llm }) =>
          Effect.gen(function* () {
            const { spawn } = yield* Effect.promise(() => import("@reddb-io/redcode-core/pty/pty.bun"))
            const before = yield* Effect.promise(() =>
              Bun.file(path.join(home, ".red", "code", "intelligence.json")).text(),
            )
            const chunks = yield* Queue.unbounded<string>()
            const exited = yield* Deferred.make<number>()
            const state = { exited: false }
            const child = spawn(process.execPath, [path.resolve(import.meta.dir, "../../src/index.ts"), "setup"], {
              name: "xterm-256color",
              cols: 120,
              rows: 35,
              cwd: home,
              env: { ...process.env, ...isolatedEnv(home, JSON.stringify(testProviderConfig(llm.url))) },
            })
            const output = child.onData((chunk) => Queue.offerUnsafe(chunks, chunk))
            const exit = child.onExit((event) => {
              state.exited = true
              Deferred.doneUnsafe(exited, Effect.succeed(event.exitCode))
            })
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                if (!state.exited) child.kill("SIGKILL")
                output.dispose()
                exit.dispose()
              }),
            )
            const received: string[] = []
            const waitFor = (text: string) =>
              Effect.gen(function* () {
                while (!received.join("").includes(text)) received.push(yield* Queue.take(chunks))
                return received.join("")
              }).pipe(
                Effect.timeoutOrElse({
                  duration: "25 seconds",
                  orElse: () => Effect.die(new Error(`Setup did not reach ${text}: ${received.join("")}`)),
                }),
              )

            expect(yield* waitFor("S2 (System Two) — principal")).not.toContain("InstanceRef not provided")
            child.write("\r")
            yield* waitFor("S2 (System Two) — transformations")
            child.write("\r")
            yield* waitFor("S1 (System One) connection")
            child.write("\u0003")
            yield* waitFor("Setup cancelled; previous configuration preserved")
            expect(yield* Deferred.await(exited).pipe(Effect.timeout("10 seconds"))).toBe(1)
            expect(
              yield* Effect.promise(() => Bun.file(path.join(home, ".red", "code", "intelligence.json")).text()),
            ).toBe(before)
          }),
        { intelligence: true },
      ),
    90_000,
  )
})
