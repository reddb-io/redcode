import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { MemoryReport } from "@reddb-io/redcode-core/observability/memory"

const linux = process.platform === "linux"
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("MemoryReport", () => {
  test("lists tracked caches and drops one when it is untracked", () => {
    let entries = 3
    const untrack = MemoryReport.track("test cache", () => ({ entries, bytes: entries * 10 }))
    cleanups.push(untrack)
    expect(MemoryReport.cacheSizes()).toContainEqual({ name: "test cache", entries: 3, bytes: 30 })
    entries = 5
    expect(MemoryReport.cacheSizes()).toContainEqual({ name: "test cache", entries: 5, bytes: 50 })
    untrack()
    expect(MemoryReport.cacheSizes().some((cache) => cache.name === "test cache")).toBe(false)
  })

  test("an untrack from a replaced registration keeps the newer one", () => {
    const first = MemoryReport.track("replaced cache", () => ({ entries: 1 }))
    const second = MemoryReport.track("replaced cache", () => ({ entries: 2 }))
    cleanups.push(second)
    first()
    expect(MemoryReport.cacheSizes()).toContainEqual({ name: "replaced cache", entries: 2 })
  })

  test("a cache whose size throws is left out instead of failing the report", () => {
    cleanups.push(
      MemoryReport.track("broken cache", () => {
        throw new Error("boom")
      }),
    )
    expect(MemoryReport.cacheSizes().some((cache) => cache.name === "broken cache")).toBe(false)
  })

  test("reports the heap of the calling thread", async () => {
    const thread = await MemoryReport.thread("test", 3)
    expect(thread.name).toBe("test")
    expect(thread.heapSize).toBeGreaterThan(0)
    expect(thread.heapCapacity).toBeGreaterThanOrEqual(thread.heapSize)
    // Object counts come from the last collection, so a young heap can still report none.
    expect(thread.topTypes.length).toBeLessThanOrEqual(3)
  })

  test.skipIf(!linux)("reads resident memory and threads from /proc", async () => {
    const stats = await MemoryReport.processStats()
    expect(stats?.pid).toBe(process.pid)
    expect(stats?.rss).toBeGreaterThan(0)
    expect(stats?.pss).toBeGreaterThan(0)
    expect(stats?.threads).toBeGreaterThan(0)
    expect(await MemoryReport.processStats(2 ** 30)).toBeUndefined()
  })

  test.skipIf(process.platform === "win32")("answers a request with a report only while listening", async () => {
    const marker = path.join(MemoryReport.directory(), `${process.pid}.listening`)
    expect(await MemoryReport.listening(process.pid)).toBe(false)
    cleanups.push(MemoryReport.track("signal cache", () => ({ entries: 7 })))
    const unlisten = MemoryReport.listen({
      name: "main",
      others: async () => ({
        threads: [await MemoryReport.thread("other")],
        caches: [{ name: "other: x", entries: 1 }],
      }),
    })
    cleanups.push(unlisten)
    expect(await MemoryReport.listening(process.pid)).toBe(true)
    expect((await fs.stat(marker)).mode & 0o777).toBe(0o600)

    const answer = await MemoryReport.request(process.pid, 5000)
    const report = answer.report!
    expect(report.pid).toBe(process.pid)
    expect(report.threads.map((thread) => thread.name)).toEqual(["main", "other"])
    expect(report.caches).toContainEqual({ name: "main: signal cache", entries: 7 })
    expect(report.caches).toContainEqual({ name: "other: x", entries: 1 })
    if (linux) expect(report.process?.rss).toBeGreaterThan(0)

    const text = MemoryReport.format(report)
    expect(text).toContain(`pid ${process.pid}`)
    expect(text).toContain("main: signal cache")
    expect(text).toContain("other")

    unlisten()
    expect(await MemoryReport.listening(process.pid)).toBe(false)
    expect(existsSync(marker)).toBe(false)
    expect((await MemoryReport.request(process.pid, 100)).refused).toContain("does not answer memory requests")
  })
  test.skipIf(process.platform === "win32")(
    "gives concurrent requests their own reports and cleans up after them",
    async () => {
      cleanups.push(MemoryReport.listen({ name: "main" }))
      const answers = await Promise.all([
        MemoryReport.request(process.pid, 5000),
        MemoryReport.request(process.pid, 5000),
      ])
      for (const answer of answers) {
        expect(answer.refused).toBeUndefined()
        expect(answer.report?.pid).toBe(process.pid)
      }
      const left = (await fs.readdir(MemoryReport.directory())).filter(
        (name) => name.startsWith(`${process.pid}.`) && !name.endsWith(".listening"),
      )
      expect(left).toEqual([])
    },
  )

  test.skipIf(process.platform === "win32")("refuses a marker whose start time is not the process's", async () => {
    const marker = path.join(MemoryReport.directory(), `${process.pid}.listening`)
    await fs.mkdir(MemoryReport.directory(), { recursive: true })
    // What a crashed process leaves behind when its pid is later reused.
    await fs.writeFile(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now() - 3_600_000 }))
    cleanups.push(() => rmSync(marker, { force: true }))
    expect(await MemoryReport.listening(process.pid)).toBe(false)
    expect((await MemoryReport.request(process.pid, 100)).refused).toContain("does not answer memory requests")
  })

  test("formats byte sizes", () => {
    expect(MemoryReport.bytes(512)).toBe("512 B")
    expect(MemoryReport.bytes(2048)).toBe("2 KB")
    expect(MemoryReport.bytes(5 * 1024 * 1024)).toBe("5.0 MB")
    expect(MemoryReport.bytes(3 * 1024 ** 3)).toBe("3.00 GB")
  })
})
