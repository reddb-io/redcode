import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { MemoryReport } from "@reddb-io/redcode-core/observability/memory"
import { isRedcode, requestReport } from "@/cli/cmd/debug/memory"

const linux = process.platform === "linux"
const memoryModule = path.resolve(import.meta.dir, "../../../core/src/observability/memory.ts")
const children: Bun.Subprocess[] = []
const directories: string[] = []
const platform = process.platform

function stubPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(async () => {
  stubPlatform(platform)
  for (const child of children.splice(0)) {
    child.kill("SIGKILL")
    await child.exited
  }
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

// A stand-in for a running redcode: it prints "ready" once it is (or is not) listening for requests.
async function spawnTarget(listen: boolean) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-debug-memory-"))
  directories.push(dir)
  const script = path.join(dir, "target.ts")
  await Bun.write(
    script,
    [
      `import { MemoryReport } from ${JSON.stringify(memoryModule)}`,
      listen ? `MemoryReport.track("fixture cache", () => ({ entries: 42 }))` : "",
      listen ? `MemoryReport.listen({ name: "main" })` : "",
      `console.log("ready")`,
      `setInterval(() => {}, 1000)`,
    ].join("\n"),
  )
  const child = Bun.spawn([process.execPath, script], { env: process.env, stdout: "pipe", stderr: "inherit" })
  children.push(child)
  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  reader.releaseLock()
  expect(new TextDecoder().decode(value)).toContain("ready")
  return child
}

describe("redcode debug memory", () => {
  test.skipIf(!linux)("reads the heap and caches of a process that listens", async () => {
    const child = await spawnTarget(true)
    const entry = await requestReport(child.pid, 5000)
    expect(entry.note).toBeUndefined()
    expect(entry.report?.pid).toBe(child.pid)
    expect(entry.report?.threads[0]?.name).toBe("main")
    expect(entry.report?.threads[0]?.heapSize).toBeGreaterThan(0)
    expect(entry.report?.caches).toContainEqual({ name: "main: fixture cache", entries: 42 })
    expect(entry.report?.process?.rss).toBeGreaterThan(0)
  })

  test.skipIf(!linux)("never signals a process that does not listen", async () => {
    const child = await spawnTarget(false)
    const entry = await requestReport(child.pid, 500)
    expect(entry.report).toBeUndefined()
    expect(entry.process?.rss).toBeGreaterThan(0)
    expect(entry.note).toContain("does not answer memory requests")
    // SIGUSR1 would have terminated it.
    await Bun.sleep(100)
    expect(child.exitCode).toBeNull()
  })

  // macOS has no /proc: the listener marker and `ps` stand in for it, and still guard the signal.
  test.skipIf(!linux)("off Linux, signals only a process whose listener marker matches", async () => {
    const quiet = await spawnTarget(false)
    const listening = await spawnTarget(true)
    stubPlatform("darwin")

    const refused = await requestReport(quiet.pid, 500)
    expect(refused.report).toBeUndefined()
    expect(refused.note).toContain("does not answer memory requests")
    await Bun.sleep(100)
    expect(quiet.exitCode).toBeNull()

    const answered = await requestReport(listening.pid, 5000)
    expect(answered.note).toBeUndefined()
    expect(answered.report?.caches).toContainEqual({ name: "main: fixture cache", entries: 42 })
  })

  test.skipIf(!linux)("off Linux, a stale marker from a reused pid is refused", async () => {
    const quiet = await spawnTarget(false)
    const marker = path.join(MemoryReport.directory(), `${quiet.pid}.listening`)
    await fs.mkdir(MemoryReport.directory(), { recursive: true })
    await fs.writeFile(marker, JSON.stringify({ pid: quiet.pid, startedAt: Date.now() - 3_600_000 }))
    stubPlatform("darwin")
    try {
      const entry = await requestReport(quiet.pid, 500)
      expect(entry.note).toContain("does not answer memory requests")
      await Bun.sleep(100)
      expect(quiet.exitCode).toBeNull()
    } finally {
      await fs.rm(marker, { force: true })
    }
  })

  test.skipIf(!linux)("on Windows, never signals", async () => {
    const listening = await spawnTarget(true)
    stubPlatform("win32")
    const entry = await requestReport(listening.pid, 500)
    expect(entry.report).toBeUndefined()
    expect(entry.note).toContain("Windows")
  })

  test("recognises compiled and development redcode command lines", () => {
    expect(isRedcode(["/home/me/.local/bin/redcode", "--yolo"])).toBe(true)
    expect(isRedcode(["redcode"])).toBe(true)
    expect(isRedcode(["bun", "run", "--cwd", "/work/redcode/packages/redcode", "src/index.ts"])).toBe(true)
    expect(isRedcode(["/usr/bin/bun", "/work/redcode/packages/redcode/src/index.ts", "serve"])).toBe(true)
    expect(isRedcode(["bun", "test"])).toBe(false)
    expect(isRedcode(["/usr/bin/redcode-helper"])).toBe(false)
    expect(isRedcode([])).toBe(false)
  })
})
