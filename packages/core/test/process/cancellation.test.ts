import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../../src/process"
import { LayerNode } from "../../src/effect/layer-node"

test.each(["abort", "timeout"] as const)(
  "%s escalates for an owned child that ignores SIGTERM",
  async (mode) => {
    if (process.platform === "win32") return
    const directory = await mkdtemp(path.join(tmpdir(), "redcode-cancel-test-"))
    const ready = path.join(directory, "ready")
    const signalled = path.join(directory, "signalled")
    const controller = new AbortController()
    const command = ChildProcess.make(process.execPath, [
      "-e",
      `
    const fs = require('node:fs');
    process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(signalled)}, 'received'));
    fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
    setInterval(() => {}, 60000);
  `,
    ])
    const running = Effect.runPromise(
      Effect.gen(function* () {
        const processes = yield* AppProcess.Service
        return yield* processes.run(
          command,
          mode === "abort" ? { signal: controller.signal } : { timeout: "2 seconds" },
        )
      }).pipe(Effect.exit, Effect.provide(LayerNode.compile(AppProcess.node))),
    )
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    let pid = 0
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = performance.now() + 1500
      while (!(await Bun.file(ready).exists()) && performance.now() < deadline) await delay(10)
      pid = Number(await Bun.file(ready).text())
      if (mode === "abort") controller.abort()
      const result = await Promise.race([
        running,
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("Child cancellation did not settle")), 7500)
        }),
      ])
      expect(result._tag).toBe("Failure")
      expect(await Bun.file(signalled).text()).toBe("received")
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      clearTimeout(watchdog)
      if (pid) {
        try {
          process.kill(-pid, "SIGKILL")
        } catch {}
      }
      controller.abort()
      await running
      await rm(directory, { recursive: true, force: true })
    }
  },
  15000,
)
