import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { database, runtime } from "../src/system-info"
import { createHostResources, cpuUtilization, cgroupCpuUtilization, cgroupMeasurements } from "../src/host-resources"
import { Effect, Logger, Schema } from "effect"
import { TestClock } from "effect/testing"
import { SystemInfo } from "@opencode/protocol/groups/server"
import { Memory } from "@opencode/schema/memory"
import { ServerFetch } from "../src/fetch"
import { it } from "../../core/test/lib/effect"

it.effect("periodic memory samples stop with the server and never boot project runtimes", () =>
  Effect.gen(function* () {
    const samples: unknown[] = []
    const logger = Logger.make((options) => {
      if (Array.isArray(options.message) && options.message[0] === "server memory sample")
        samples.push(options.message[1])
    })
    yield* Effect.gen(function* () {
      yield* ServerFetch.make({
        database: { path: ":memory:" },
        config: { project: false, global: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      })
      yield* TestClock.adjust("2 minutes")
      expect(samples).toHaveLength(3)
      for (const sample of samples)
        expect(sample).toMatchObject({
          pid: process.pid,
          cachedLocations: 0,
          activeExecutions: 0,
          eventSubscribers: 0,
          eventQueuedBytes: 0,
          eventRetainedBytes: 0,
        })
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([logger], { mergeWithExisting: false })))
    yield* TestClock.adjust("2 minutes")
    expect(samples).toHaveLength(3)
  }),
)

it.live("memory diagnostics report the server heap without booting project runtimes", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "memory-test" },
      database: { path: ":memory:" },
      config: { project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const request = new Request("http://opencode.local/api/system", {
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })
    for (let index = 0; index < 3; index++) {
      const response = yield* Effect.promise(() => handler(request.clone()))
      expect(response.status).toBe(200)
      const snapshot = Schema.decodeUnknownSync(SystemInfo)(yield* Effect.promise(() => response.json()))
      expect(snapshot.pid).toBe(process.pid)
      expect(snapshot.memory).toBeGreaterThan(0)
      expect(snapshot.processMemory?.heapUsed).toBeGreaterThan(0)
      expect(snapshot.processMemory?.heapTotal).toBeGreaterThan(0)
      expect(snapshot.processMemory?.external).toBeGreaterThanOrEqual(0)
      expect(snapshot.processMemory?.arrayBuffers).toBeGreaterThanOrEqual(0)
      expect(snapshot.activity).toEqual({
        cachedLocations: 0,
        activeExecutions: 0,
        eventFeed: {
          subscribers: 0,
          queuedBytes: 0,
          peakQueuedBytes: 0,
          frames: 0,
          encodedBytes: 0,
          largestFrameBytes: 0,
          frameBytesP50: 0,
          frameBytesP95: 0,
          frameBytesP99: 0,
          overflows: 0,
          acknowledgements: 0,
          replayedFrames: 0,
          replayMisses: 0,
          retainedFrames: 0,
          retainedBytes: 0,
          cursor: 0,
          oldestCursor: 0,
          acknowledgedClients: 0,
          maxAcknowledgementLag: 0,
        },
      })
      expect(snapshot.clients).toEqual({
        total: 0,
        desktop: 0,
        web: 0,
        tui: 0,
        cli: 0,
        api: 0,
        automation: 0,
        worker: 0,
        unknown: 0,
      })
    }
  }).pipe(Effect.scoped),
)

it.live("execution memory requires authentication and works without booting locations", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      database: { path: ":memory:" },
      config: { project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    })
    const anonymous = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/memory")))
    expect(anonymous.status).toBe(401)
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/memory", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(response.status).toBe(200)
    const snapshot = Schema.decodeUnknownSync(Memory.Snapshot)(yield* Effect.promise(() => response.json()))
    expect(snapshot.entries).toEqual([])
  }).pipe(Effect.scoped),
)

it.live(
  "execution memory attributes a running shell to its actual process",
  () =>
    Effect.gen(function* () {
      const handler = yield* ServerFetch.make({
        database: { path: ":memory:" },
        config: { project: false, global: false },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "secret",
      })
      const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
      const command = process.platform === "win32" ? "ping 127.0.0.1 -n 20" : "sleep 20"
      const started = yield* Effect.promise(() =>
        handler(
          new Request("http://opencode.local/api/shell", {
            method: "POST",
            headers,
            body: JSON.stringify({ command }),
          }),
        ),
      )
      expect(started.status).toBe(200)
      const body = (yield* Effect.promise(() => started.json())) as { data: { id: string; pid: number } }
      const response = yield* Effect.promise(() =>
        handler(new Request("http://opencode.local/api/memory", { headers })),
      )
      expect(response.status).toBe(200)
      const snapshot = Schema.decodeUnknownSync(Memory.Snapshot)(yield* Effect.promise(() => response.json()))
      const task = snapshot.entries.find((entry) => entry.id === body.data.id)
      expect(task?.pid).toBe(body.data.pid)
      expect(task?.residentBytes).toBeGreaterThan(0)
      yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/shell/${body.data.id}`, { method: "DELETE", headers })),
      )
    }).pipe(Effect.scoped),
  30_000,
)

describe("system info", () => {
  test("cgroup v2 measurements use quota-normalized CPU and distinguish unlimited/missing kernel values", () => {
    expect(
      cgroupMeasurements({
        cpuMax: "50000 100000",
        cpuStat: "nr_periods 4\nusage_usec 200000\n",
        memoryMax: "1073741824\n",
        memoryCurrent: "0\n",
      }),
    ).toEqual({ cpu: 0.5, usageMicros: 200000, memoryMax: 1073741824, memoryCurrent: 0 })
    expect(cgroupMeasurements({ cpuMax: "max 100000", memoryMax: "max", memoryCurrent: "invalid" })).toEqual({
      cpu: undefined,
      usageMicros: undefined,
      memoryMax: undefined,
      memoryCurrent: undefined,
    })
    const previous = { source: "/container", usageMicros: 100000, capacity: 0.5, sampledAt: 1000 }
    const current = { ...previous, usageMicros: 350000, sampledAt: 2000 }
    expect(cgroupCpuUtilization(undefined, current)).toBeNull()
    expect(cgroupCpuUtilization(previous, current)).toBe(0.5)
    expect(cgroupCpuUtilization(previous, { ...current, usageMicros: 900000 })).toBe(1)
    expect(cgroupCpuUtilization(previous, { ...current, source: "/other" })).toBeNull()
    expect(cgroupCpuUtilization(previous, { ...current, capacity: 1 })).toBeNull()
  })
  test("CPU measurements require fresh monotonic counters from the same host sample", () => {
    const before = { count: 4, idle: 100, total: 200, sampledAt: 1000 }
    const after = { count: 4, idle: 150, total: 400, sampledAt: 6000 }
    expect(cpuUtilization(undefined, after)).toBeNull()
    expect(cpuUtilization(before, after)).toBe(0.75)
    for (const changed of [
      { ...after, count: 0 },
      { ...after, count: 8 },
      { ...after, sampledAt: 1000 },
      { ...after, sampledAt: 32000 },
      { ...after, total: 199 },
      { ...after, idle: 99 },
      { ...after, idle: 400 },
    ])
      expect(cpuUtilization(before, changed)).toBeNull()
  })

  test("a new host sampler reports unknown CPU usage and OS memory separately from process RSS", async () => {
    const sample = await createHostResources()()
    expect(sample.cpu.utilization).toBeNull()
    expect(sample.memory.totalBytes).toBeGreaterThan(0)
    expect(sample.memory.freeBytes).toBeGreaterThanOrEqual(0)
    expect(sample.process.residentBytes).toBeGreaterThan(0)
    expect(sample.process.pid).toBe(process.pid)
  })
  test("names a remote database by its protocol and host, never its path or token", async () => {
    expect(await database({ url: "reds://db.example.com:5050/private/path" })).toEqual({
      kind: "remote",
      protocol: "reds",
      host: "db.example.com:5050",
    })
  })

  test("sizes a local database from its file and its write-ahead log", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-system-info-"))
    try {
      const file = path.join(directory, "opencode.db")
      await Bun.write(file, "x".repeat(1000))
      await Bun.write(`${file}-wal`, "y".repeat(30))
      expect(await database({ path: file })).toEqual({ kind: "local", path: file, size: 1000, wal: 30 })
      await fs.rm(`${file}-wal`)
      expect(await database({ path: file })).toEqual({ kind: "local", path: file, size: 1000 })
      expect(await database({ path: path.join(directory, "missing.db") })).toEqual({
        kind: "local",
        path: path.join(directory, "missing.db"),
      })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("is in memory without a path, or with the in-memory path", async () => {
    expect(await database(undefined)).toEqual({ kind: "memory" })
    expect(await database({})).toEqual({ kind: "memory" })
    expect(await database({ path: ":memory:" })).toEqual({ kind: "memory" })
  })

  test("names the runtime and its version", () => {
    expect(runtime()).toMatch(/^(bun|node) \S+$/)
  })
})
