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
    "changing S2 in dual walks S2 models before offering the saved S1 and preserves settings when cancelled",
    () =>
      withCliFixture(
        ({ home, llm }) =>
          Effect.gen(function* () {
            const before = yield* Effect.promise(() => Bun.file(settingsPath(home)).text())
            const terminal = yield* setupTerminal(home, llm.url)
            expect(yield* terminal.waitFor("Reasoning mode")).not.toContain("InstanceRef not provided")
            terminal.write("\r")
            yield* terminal.waitFor("Continue with")
            terminal.write("\u001b[B")
            terminal.write("\r")
            yield* terminal.waitFor("S2 (System Two) — principal")
            terminal.write("\r")
            yield* terminal.waitFor("S2 (System Two) — transformations")
            terminal.write("\r")
            yield* terminal.waitFor("Continue with typesafe/jev-test")
            terminal.write("\u0003")
            yield* terminal.waitFor("Setup cancelled; previous configuration preserved")
            expect(yield* terminal.exited).toBe(1)
            expect(yield* Effect.promise(() => Bun.file(settingsPath(home)).text())).toBe(before)
          }),
        { intelligence: true },
      ),
    90_000,
  )

  interactive(
    "continuing with the saved S2 goes straight to S1 in dual",
    () =>
      withCliFixture(
        ({ home, llm }) =>
          Effect.gen(function* () {
            const before = yield* Effect.promise(() => Bun.file(settingsPath(home)).text())
            const terminal = yield* setupTerminal(home, llm.url)
            yield* terminal.waitFor("Reasoning mode")
            terminal.write("\r")
            yield* terminal.waitFor("Continue with")
            terminal.write("\r")
            expect(yield* terminal.waitFor("Continue with typesafe/jev-test")).not.toContain(
              "S2 (System Two) — transformations",
            )
            terminal.write("\u0003")
            yield* terminal.waitFor("Setup cancelled; previous configuration preserved")
            expect(yield* terminal.exited).toBe(1)
            expect(yield* Effect.promise(() => Bun.file(settingsPath(home)).text())).toBe(before)
          }),
        { intelligence: true },
      ),
    90_000,
  )
})

const settingsPath = (home: string) => path.join(home, ".red", "code", "intelligence.json")

function setupTerminal(home: string, llm: string) {
  return Effect.gen(function* () {
    const { spawn } = yield* Effect.promise(() => import("@reddb-io/redcode-core/pty/pty.bun"))
    const chunks = yield* Queue.unbounded<string>()
    const exited = yield* Deferred.make<number>()
    const state = { exited: false }
    const child = spawn(process.execPath, [path.resolve(import.meta.dir, "../../src/index.ts"), "setup"], {
      name: "xterm-256color",
      cols: 120,
      rows: 35,
      cwd: home,
      env: isolatedEnv(home, JSON.stringify(testProviderConfig(llm))),
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
    return {
      write: (data: string) => child.write(data),
      exited: Deferred.await(exited).pipe(Effect.timeout("10 seconds")),
      waitFor: (text: string) =>
        Effect.gen(function* () {
          while (!received.join("").includes(text)) received.push(yield* Queue.take(chunks))
          return received.join("")
        }).pipe(
          Effect.timeoutOrElse({
            duration: "25 seconds",
            orElse: () => Effect.die(new Error(`Setup did not reach ${text}: ${received.join("")}`)),
          }),
        ),
    }
  })
}
