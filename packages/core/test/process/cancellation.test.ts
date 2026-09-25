import { expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../../src/process"
import { LayerNode } from "../../src/effect/layer-node"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))

// The child renames each file into place, so an existing file always holds its full contents.
const waitForFile = (file: string) =>
  Effect.promise(async () => {
    while (!(await Bun.file(file).exists())) await Bun.sleep(10)
    return Bun.file(file).text()
  })

for (const mode of ["abort", "timeout"] as const)
  it.effect(
    `${mode} escalates for an owned child that ignores SIGTERM`,
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const directory = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "redcode-cancel-test-")))
      yield* Effect.addFinalizer(() => Effect.promise(() => rm(directory, { recursive: true, force: true })))
      const ready = path.join(directory, "ready")
      const signalled = path.join(directory, "signalled")
      const controller = new AbortController()
      const command = ChildProcess.make(process.execPath, [
        "-e",
        `
    const fs = require('node:fs');
    const publish = (file, text) => {
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    };
    process.on('SIGTERM', () => publish(${JSON.stringify(signalled)}, 'received'));
    publish(${JSON.stringify(ready)}, String(process.pid));
    setInterval(() => {}, 60000);
  `,
      ])
      const processes = yield* AppProcess.Service
      // The run timeout and the force-kill grace period both run on the TestClock, so a child
      // that starts slowly on a loaded machine cannot be timed out before it installs its handler.
      const running = yield* processes
        .run(command, mode === "abort" ? { signal: controller.signal } : { timeout: "2 seconds" })
        .pipe(Effect.exit, Effect.forkScoped)
      const pid = Number(yield* waitForFile(ready))
      // Runs before the run fiber is interrupted, so a failed assertion never waits on the TestClock.
      yield* Effect.addFinalizer(() =>
        Effect.try({ try: () => process.kill(-pid, "SIGKILL"), catch: (error) => error }).pipe(Effect.ignore),
      )

      if (mode === "abort") controller.abort()
      if (mode === "timeout") yield* TestClock.adjust("2 seconds")
      expect(yield* waitForFile(signalled)).toBe("received")
      // The child ignored SIGTERM; elapsing the force-kill grace period must escalate to SIGKILL.
      yield* TestClock.adjust("3 seconds")
      const result = yield* Fiber.join(running)

      expect(result._tag).toBe("Failure")
      expect(() => process.kill(pid, 0)).toThrow()
    }),
    15000,
  )
