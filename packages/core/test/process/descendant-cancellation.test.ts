import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../../src/process"
import { LayerNode } from "../../src/effect/layer-node"

const alive = async (pid: number) => {
  if (process.platform === "linux") {
    const state = await Bun.file(`/proc/${pid}/stat`)
      .text()
      .catch(() => "")
    return !!state && state.slice(state.lastIndexOf(")") + 2).charAt(0) !== "Z"
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

for (const mode of ["abort", "timeout", "success"] as const)
  test(
    mode === "success"
      ? "successful background commands retain explicitly unpiped descendants"
      : `${mode} terminates stdio-holding descendants after their leader exits successfully`,
    async () => {
      if (process.platform === "win32") return
      const directory = await mkdtemp(path.join(tmpdir(), "redcode-descendants-"))
      const ready = path.join(directory, "ready")
      const parent = path.join(directory, "parent")
      const signalled = path.join(directory, "signalled")
      const controller = new AbortController()
      const child = `const fs = require('node:fs'); process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(signalled)}, 'received')); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 60000)`
      const command = ChildProcess.make(
        process.execPath,
        [
          "-e",
          `const fs = require('node:fs'); const { spawn } = require('node:child_process'); fs.writeFileSync(${JSON.stringify(parent)}, String(process.pid)); spawn(process.execPath, ['-e', ${JSON.stringify(child)}], ${mode === "success" ? "{ stdio: 'ignore' }" : "{ stdio: ['ignore', 'inherit', 'inherit'] }"}).unref(); process.exit(0)`,
        ],
        { forceKillAfter: "100 millis" },
      )
      const running = Effect.runPromise(
        Effect.gen(function* () {
          const processes = yield* AppProcess.Service
          return yield* processes.run(
            command,
            mode === "abort" ? { signal: controller.signal } : { timeout: "2 seconds" },
          )
        }).pipe(Effect.exit, Effect.provide(LayerNode.compile(AppProcess.node))),
      )
      const owned = { child: 0, parent: 0 }
      try {
        const deadline = Date.now() + 1500
        while (!(await Bun.file(ready).exists()) && Date.now() < deadline) await Bun.sleep(10)
        owned.child = Number(await Bun.file(ready).text())
        owned.parent = Number(await Bun.file(parent).text())
        expect(await alive(owned.parent)).toBe(false)
        if (mode === "abort") controller.abort()
        expect((await running)._tag).toBe(mode === "success" ? "Success" : "Failure")
        expect(await alive(owned.child)).toBe(mode === "success")
        if (mode !== "success") expect(await Bun.file(signalled).text()).toBe("received")
      } finally {
        if (!owned.child && (await Bun.file(ready).exists())) owned.child = Number(await Bun.file(ready).text())
        if (!owned.parent && (await Bun.file(parent).exists())) owned.parent = Number(await Bun.file(parent).text())
        if (owned.parent) {
          try {
            process.kill(-owned.parent, "SIGKILL")
          } catch {}
        }
        if (owned.child) {
          try {
            process.kill(owned.child, "SIGKILL")
          } catch {}
        }
        controller.abort()
        await running
        await rm(directory, { recursive: true, force: true })
      }
    },
    15000,
  )
