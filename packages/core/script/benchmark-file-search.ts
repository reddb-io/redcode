/**
 * Isolated comparison of the production ripgrep/fuzzysort and FFF search layers.
 * Run from packages/core. Never connects to the installed service or providers.
 * Each sample gets a fresh process; fixtures and raw results stay outside Git.
 *
 * bun run script/benchmark-file-search.ts --out C:/path/to/results --sizes 1000,10000,50000 --runs 5
 * Add --tracked for committed fixtures; use a separate output directory for each fixture mode.
 * --probe lifecycle checks create/rename/delete; --settle-ms delays that probe only.
 * --cpu-accounting-uncertain marks CPU time as diagnostic and prevents standard promotion.
 * Child mode also supports --cycles for repeated acquisition and disposal in one process.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, Fiber, Layer, Logger } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileSystemSearch } from "../src/filesystem/search"
import { Location } from "../src/location"
import { Environment } from "../src/environment"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { AbsolutePath } from "../src/schema"
import { location } from "../test/fixture/location"

const args = process.argv.slice(2)
const option = (key: string, fallback: string) => {
  const index = args.indexOf(`--${key}`)
  return index < 0 ? fallback : (args[index + 1] ?? fallback)
}
const out = path.resolve(option("out", path.join(os.tmpdir(), "redcode-fff-poc")))
const backend = option("child", "")
const engines = option("engines", "ripgrep,fff").split(",")
const workload = option("workload", "standard")
if (workload !== "standard" && workload !== "typo") throw new Error("--workload must be standard or typo")
const rg = Bun.which("rg")
if (!rg) throw new Error("Install ripgrep before running this benchmark; downloads are disabled")
const nativeMetrics = process.platform === "win32" ? await import("./file-search-benchmark-metrics") : undefined
const processMetrics = nativeMetrics?.openProcessMetrics(process.pid)
if (process.platform === "win32" && !processMetrics) throw new Error("Windows process counters are unavailable")
const cpuUsage = () => processMetrics?.cpu() ?? process.cpuUsage()

type Query = { query: string; type?: "file" | "directory"; limit: number }
type Fixture = { directory: string; count: number; files: string[]; queries: Query[]; hash: string }

function memory() {
  const value = process.memoryUsage()
  return {
    rss: value.rss,
    heapUsed: value.heapUsed,
    heapTotal: value.heapTotal,
    external: value.external,
    threads: processMetrics?.threads(),
    windows: processMetrics?.memory(),
  }
}

function retained() {
  Bun.gc(true)
  Bun.gc(true)
  return memory()
}

function cpu(before: NodeJS.CpuUsage) {
  const value = cpuUsage()
  return {
    userMs: (value.user - before.user) / 1_000,
    systemMs: (value.system - before.system) / 1_000,
    totalMs: (value.user + value.system - before.user - before.system) / 1_000,
  }
}

function cpuDifference(before: NodeJS.CpuUsage, after: NodeJS.CpuUsage) {
  return {
    userMs: (after.user - before.user) / 1_000,
    systemMs: (after.system - before.system) / 1_000,
    totalMs: (after.user + after.system - before.user - before.system) / 1_000,
  }
}

function distribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? 0,
  }
}

async function fixture(count: number): Promise<Fixture> {
  const directory = path.join(path.resolve(option("fixture-root", out)), `fixture-${count}`)
  await fs.mkdir(directory, { recursive: true })
  const manifest = path.join(directory, "fixture.json")
  if (await Bun.file(manifest).exists()) {
    const tracked = Bun.spawnSync(["git", "-C", directory, "rev-parse", "--verify", "HEAD"]).exitCode === 0
    if (tracked !== args.includes("--tracked"))
      throw new Error("Fixture mode changed; choose a separate --out directory")
    return Bun.file(manifest).json()
  }
  const families = ["session", "provider", "filesystem", "renderer", "protocol", "database", "worker", "markdown"]
  const files = Array.from({ length: count }, (_, index) => {
    const group = Math.floor(index / 100)
      .toString()
      .padStart(4, "0")
    const family = families[index % families.length]!
    return `modules/package-${group}/src/${family}/${family}-component-${index.toString().padStart(6, "0")}.${index % 3 === 0 ? "tsx" : "ts"}`
  })
  files.push(
    "modules/espaço/ação.ts",
    "modules/日本語/検索.ts",
    "modules/emoji/rocket-🚀.ts",
    "modules/space name/file name.ts",
  )
  await Promise.all(
    [...new Set(files.map((file) => path.dirname(file)))].map((dir) =>
      fs.mkdir(path.join(directory, dir), { recursive: true }),
    ),
  )
  // Bounded writes keep fixture construction from competing with later timed runs.
  for (let offset = 0; offset < files.length; offset += 64)
    await Promise.all(
      files
        .slice(offset, offset + 64)
        .map((file) => Bun.write(path.join(directory, file), "export const fixture = true\n")),
    )
  await fs.mkdir(path.join(directory, "modules/ignored/target/debug"), { recursive: true })
  await Bun.write(path.join(directory, ".gitignore"), "**/target/\n*.log\nfixture.json\n")
  await Bun.write(path.join(directory, "modules/ignored/target/debug/excluded-marker.ts"), "ignored\n")
  await Bun.write(path.join(directory, "modules/excluded-marker.log"), "ignored\n")
  await Bun.write(path.join(directory, "modules/.hidden-marker.ts"), "hidden\n")
  const init = Bun.spawnSync(["git", "init", "-q", directory])
  if (init.exitCode !== 0) throw new Error(init.stderr.toString())
  if (args.includes("--tracked")) {
    const added = Bun.spawnSync(["git", "-C", directory, "add", "."])
    if (added.exitCode !== 0) throw new Error(added.stderr.toString())
    const committed = Bun.spawnSync([
      "git",
      "-C",
      directory,
      "-c",
      "user.name=RedCode benchmark",
      "-c",
      "user.email=benchmark@example.invalid",
      "-c",
      "commit.gpgSign=false",
      "-c",
      `core.hooksPath=${path.join(directory, ".git/no-hooks")}`,
      "commit",
      "-qm",
      "Synthetic search benchmark fixture",
    ])
    if (committed.exitCode !== 0) throw new Error(committed.stderr.toString())
  }
  const queries: Query[] = [
    ...[
      "session",
      "provider",
      "fsys",
      "renderer component",
      "database",
      "worker",
      "markdown",
      "component-000000",
      "zzzz-no-result-987654321",
      "ação",
      "検索",
      "rocket-🚀",
      "file name",
    ].map((query) => ({ query, type: "file" as const, limit: 50 })),
    { query: "src", type: "directory", limit: 50 },
    { query: "session", limit: 50 },
    { query: "", type: "file", limit: 50 },
  ]
  const result = { directory, count, files, queries, hash: createHash("sha256").update(files.join("\n")).digest("hex") }
  await Bun.write(manifest, JSON.stringify(result, null, 2))
  return result
}

async function measure(data: Fixture) {
  const children: Array<{ cpu: NodeJS.CpuUsage; memory: ReturnType<typeof memory>["windows"] }> = []
  const local = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const driver = Environment.makeLocalDriver(spawner)
      return Environment.Service.of({
        spawner: {
          ...spawner,
          spawn: (command) =>
            Effect.gen(function* () {
              const child = yield* spawner.spawn(command)
              const metrics = nativeMetrics?.openProcessMetrics(Number(child.pid))
              if (metrics)
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    children.push({ cpu: metrics.cpu(), memory: metrics.memory() })
                    metrics.close()
                  }),
                )
              return child
            }),
        },
        files: Environment.makeFiles(driver),
      })
    }),
  ).pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node)))
  const ripgrep = LayerNode.compile(Ripgrep.node, {
    replacements: [
      Environment.node.replace(local),
      RipgrepBinary.node.replace(Layer.succeed(RipgrepBinary.Service, { filepath: Effect.succeed(rg!) })),
    ],
  })
  const ref = Location.Ref.make({ directory: AbsolutePath.make(data.directory) })
  let workerDiagnostics:
    | {
        cpuMicros: number
        nativeWallMicros: number
        nativeThreadCpuMicros: number
        pids: Set<number>
        runtimePids: Set<number>
      }
    | undefined
  let nativeLoadDiagnostics:
    | {
        attempts: number
        failures: number
        runtimeFailures: number
        buildsStarted: number
        selected?: "rust" | "legacy"
        lastErrorCategory?: string
      }
    | undefined
  let selected = backend === "fff" ? FileSystemSearch.fffLayer : FileSystemSearch.ripgrepLayer
  let productFallback = false
  if (backend === "product") {
    const library = option("native-lib", "")
    const { loadNucleoLibrary } = await import("../src/filesystem/search-native.bun")
    const loaded = loadNucleoLibrary(library)
    if (!loaded.ok) throw loaded.error
    selected = FileSystemSearch.layer({ fff: false, native: { library } })
  }
  if (backend === "nucleo") {
    const { nucleoLayer } = await import("./file-search-nucleo")
    selected = nucleoLayer(option("native-lib", ""))
  }
  if (backend === "nucleo-async") {
    const { nucleoAsyncLayer } = await import("./file-search-nucleo")
    selected = nucleoAsyncLayer(option("native-lib", ""))
  }
  if (backend === "nucleo-fallback") {
    const { nucleoLoadFallbackLayer } = await import("./file-search-nucleo-fallback")
    nativeLoadDiagnostics = { attempts: 0, failures: 0, runtimeFailures: 0, buildsStarted: 0 }
    const fault = option("native-fault", "")
    selected = nucleoLoadFallbackLayer(
      option("native-lib", ""),
      nativeLoadDiagnostics,
      fault === "build" || fault === "search" ? { fault } : undefined,
    )
  }
  if (backend === "nucleo-worker") {
    const { nucleoWorkerLayer } = await import("./file-search-nucleo-worker")
    workerDiagnostics = {
      cpuMicros: 0,
      nativeWallMicros: 0,
      nativeThreadCpuMicros: 0,
      pids: new Set(),
      runtimePids: new Set(),
    }
    selected = nucleoWorkerLayer(option("native-lib", ""), workerDiagnostics)
  }
  if (backend === "nucleo-napi") {
    const { nucleoNapiLayer } = await import("./file-search-nucleo-napi")
    selected = nucleoNapiLayer(option("napi-lib", ""))
  }
  if (backend === "nucleo-napi-sync") {
    const { nucleoNapiLayer } = await import("./file-search-nucleo-napi")
    selected = nucleoNapiLayer(option("napi-lib", ""), "sync")
  }
  const layer = selected.pipe(
    Layer.provide(ripgrep),
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(ref, {
            vcs: { type: "git", store: AbsolutePath.make(path.join(data.directory, ".git")) },
          }),
        ),
      ),
    ),
  )
  const before = retained()
  let peakRssSampled = before.rss
  const sampler = setInterval(() => {
    peakRssSampled = Math.max(peakRssSampled, memory().rss)
  }, 10)
  const startupEventLoopLag: number[] = []
  let expectedStartupTick = performance.now() + 5
  const startupEventLoopTimer = setInterval(() => {
    const now = performance.now()
    startupEventLoopLag.push(Math.max(0, now - expectedStartupTick))
    expectedStartupTick = now + 5
  }, 5)
  await Bun.sleep(10)
  const startCpu = cpuUsage()
  const start = performance.now()
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const search = yield* FileSystemSearch.Service
      if (option("probe", "") === "cancellation") {
        if (!nativeLoadDiagnostics) throw new Error("cancellation probe requires nucleo-fallback")
        const started = performance.now()
        const cancelled = yield* search.find(data.queries[0]!).pipe(Effect.forkScoped)
        while (nativeLoadDiagnostics.buildsStarted === 0) {
          if (performance.now() - started > 30_000) throw new Error("Rust build did not start before cancellation")
          yield* Effect.sleep("5 millis")
        }
        yield* Fiber.interrupt(cancelled)
        const cancelledAtMs = performance.now() - started
        yield* Effect.sleep("50 millis")
        if (nativeLoadDiagnostics.selected !== "rust" || nativeLoadDiagnostics.runtimeFailures !== 0)
          throw new Error("Cancellation incorrectly selected legacy fallback")
        const recoveryStarted = performance.now()
        const recovered = yield* search.find(data.queries[0]!)
        const recoveryMs = performance.now() - recoveryStarted
        if (recovered.length !== 50) throw new Error(`Cancellation recovery returned ${recovered.length}, expected 50`)
        if (nativeLoadDiagnostics.selected !== "rust" || nativeLoadDiagnostics.runtimeFailures !== 0)
          throw new Error("Cancellation recovery incorrectly selected legacy fallback")
        const loaded = retained()
        const idleStarted = cpuUsage()
        yield* Effect.sleep("500 millis")
        return {
          before,
          loaded,
          cancellationPassed: true,
          cancelledAtMs,
          recoveryMs,
          recovered: recovered.length,
          idleCpu: cpu(idleStarted),
          peakRssSampled,
        }
      }
      const first = yield* search.find(data.queries[0]!)
      const firstResponseMs = performance.now() - start
      yield* Effect.sleep("1 millis")
      clearInterval(startupEventLoopTimer)
      const startupEventLoopLagMs = distribution(startupEventLoopLag)
      // Both implementations must expose the entire known corpus before warm timing.
      // The readiness time includes this verification query, not just native scanning.
      const readyStart = performance.now()
      let indexed: string[] = []
      while (true) {
        indexed = (yield* search.find({ query: "modules", type: "file", limit: data.files.length + 100 })).map(
          (entry) => entry.path.replaceAll("\\", "/"),
        )
        const available = new Set(indexed)
        if (data.files.every((file) => available.has(file))) break
        if (performance.now() - readyStart > 30_000)
          throw new Error(`Incomplete ${backend} index: ${indexed.length}/${data.files.length}`)
        yield* Effect.sleep("50 millis")
      }
      const verifiedReadyMs = performance.now() - start
      const startupCpu = cpu(startCpu)
      const expected = new Set(data.files)
      const extra = indexed.filter((file) => !expected.has(file))
      indexed = []
      const loaded = retained()
      const workerProcesses = workerDiagnostics
        ? [...workerDiagnostics.pids]
            .filter((pid) => pid !== process.pid)
            .map((pid) => ({ pid, metrics: nativeMetrics?.openProcessMetrics(pid) }))
            .filter((entry): entry is { pid: number; metrics: NonNullable<typeof entry.metrics> } => !!entry.metrics)
        : []
      if (workerProcesses.length)
        yield* Effect.addFinalizer(() => Effect.sync(() => workerProcesses.forEach((entry) => entry.metrics.close())))
      const workerLoaded = workerProcesses.map((entry) => ({ pid: entry.pid, memory: entry.metrics.memory() }))
      if (option("probe", "") === "soak") {
        const durationMs = Number(option("soak-ms", "60000"))
        if (durationMs < 60_000) throw new Error("soak probe requires --soak-ms >= 60000")
        const created = "modules/aaa-nucleo-soak.ts"
        const absolute = path.join(data.directory, created)
        if (yield* Effect.promise(() => Bun.file(absolute).exists()))
          throw new Error(`Probe file already exists: ${created}; use a fresh fixture`)
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(absolute, { force: true })))
        const latency: number[] = []
        const eventLoopLag: number[] = []
        const rssSamples = [loaded.rss]
        const mutations: Array<{ action: "create" | "delete"; visibleAfterMs: number }> = []
        let expectedTick = performance.now() + 5
        const eventLoopTimer = setInterval(() => {
          const now = performance.now()
          eventLoopLag.push(Math.max(0, now - expectedTick))
          expectedTick = now + 5
        }, 5)
        const started = performance.now()
        const endsAt = started + durationMs
        const soakCpu = cpuUsage()
        // Mutate shortly before the next refresh boundary. Scheduling after it
        // would let the continuous query stream run an empty refresh first.
        let nextMutationAt = started + 9_500
        let nextMemoryAt = started + 1_000
        let present = false
        let pending: { present: boolean; started: number } | undefined
        let queries = 0
        let invalid = 0
        const top1 = new Set<string | undefined>()
        try {
          while (performance.now() < endsAt || pending) {
            const now = performance.now()
            if (!pending && now >= nextMutationAt && now < endsAt) {
              present = !present
              if (present) yield* Effect.promise(() => Bun.write(absolute, "export const soakProbe = true\n"))
              else yield* Effect.promise(() => fs.rm(absolute, { force: true }))
              pending = { present, started: performance.now() }
            }
            const mark = performance.now()
            const entries = yield* search.find({ query: "session", type: "file", limit: 50 })
            latency.push(performance.now() - mark)
            queries++
            top1.add(entries[0]?.path)
            if (
              entries.length !== 50 ||
              entries.some((entry) => entry.type !== "file") ||
              new Set(entries.map((entry) => entry.path)).size !== entries.length
            )
              invalid++
            if (pending) {
              const probe = yield* search.find({ query: "aaa-nucleo-soak", type: "file", limit: 50 })
              const visible = probe.some((entry) => entry.path.replaceAll("\\", "/") === created)
              if (visible === pending.present) {
                mutations.push({ action: pending.present ? "create" : "delete", visibleAfterMs: performance.now() - pending.started })
                pending = undefined
                nextMutationAt = performance.now() + 9_500
              } else if (performance.now() - pending.started > 12_000) {
                throw new Error("Soak mutation did not become visible within 12 seconds")
              }
            }
            if (performance.now() >= nextMemoryAt) {
              rssSamples.push(memory().rss)
              nextMemoryAt = performance.now() + 1_000
            }
            yield* Effect.sleep("50 millis")
          }
        } finally {
          clearInterval(eventLoopTimer)
        }
        const afterSoak = retained()
        const latencyMs = distribution(latency)
        const eventLoopLagMs = distribution(eventLoopLag)
        const rssDeltaMiB = (afterSoak.rss - loaded.rss) / 1024 / 1024
        const idleStarted = cpuUsage()
        yield* Effect.sleep("500 millis")
        const idleCpu = cpu(idleStarted)
        const gates = {
          validResults: invalid === 0 && top1.size === 1,
          mutations: mutations.length >= 4 && mutations.every((item) => item.visibleAfterMs <= 12_000),
          latency: latencyMs.p95 <= 12,
          eventLoop: eventLoopLagMs.max < 100,
          memory: rssDeltaMiB <= 15,
          idle: idleCpu.totalMs <= 31.25,
        }
        const soakPassed = Object.values(gates).every(Boolean)
        return {
          before,
          loaded,
          afterSoak,
          soakPassed,
          gateFailures: Object.entries(gates)
            .filter(([, passed]) => !passed)
            .map(([gate]) => gate),
          durationMs: performance.now() - started,
          queries,
          invalid,
          top1Variants: top1.size,
          mutations,
          latencyMs,
          eventLoopLagMs,
          soakCpu: cpu(soakCpu),
          rssMiB: {
            loaded: loaded.rss / 1024 / 1024,
            end: afterSoak.rss / 1024 / 1024,
            delta: rssDeltaMiB,
            sampledPeak: Math.max(...rssSamples) / 1024 / 1024,
          },
          idleCpu,
          gates,
          peakRssSampled,
        }
      }
      if (option("probe", "") === "concurrency") {
        const settleMs = Number(option("settle-ms", "10100"))
        if (settleMs < 10_000) throw new Error("concurrency probe requires --settle-ms >= 10000")
        const created = "modules/aaa-nucleo-concurrency.ts"
        const absolute = path.join(data.directory, created)
        if (yield* Effect.promise(() => Bun.file(absolute).exists()))
          throw new Error(`Probe file already exists: ${created}; use a fresh fixture`)
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(absolute, { force: true })))
        yield* Effect.sleep(settleMs)
        yield* Effect.promise(() => Bun.write(absolute, "export const concurrencyProbe = true\n"))
        const started = performance.now()
        const batchCpu = cpuUsage()
        const batch = yield* Effect.all(
          Array.from({ length: 640 }, () => search.find({ query: "session", type: "file", limit: 50 })),
          { concurrency: "unbounded" },
        )
        const batchElapsedMs = performance.now() - started
        const batchCpuUsage = cpu(batchCpu)
        const invalidBatch = batch.filter(
          (entries) =>
            entries.length !== 50 ||
            entries.some((entry) => entry.type !== "file") ||
            new Set(entries.map((entry) => entry.path)).size !== entries.length,
        ).length
        const top1 = new Set(batch.map((entries) => entries[0]?.path))
        if (invalidBatch || top1.size !== 1)
          throw new Error(`Concurrent batch violated snapshot contract: invalid=${invalidBatch}, top1=${top1.size}`)
        let visibleAfterMs = 0
        while (true) {
          const entries = yield* search.find({ query: "aaa-nucleo-concurrency", type: "file", limit: 50 })
          const visible = entries.some((entry) => entry.path.replaceAll("\\", "/") === created)
          if (visible) {
            visibleAfterMs = performance.now() - started
            break
          }
          if (performance.now() - started > 12_000) throw new Error("Concurrent refresh did not publish within 12 seconds")
          yield* Effect.sleep("25 millis")
        }
        const afterPublish = yield* Effect.all(
          Array.from({ length: 64 }, () => search.find({ query: "aaa-nucleo-concurrency", type: "file", limit: 50 })),
          { concurrency: "unbounded" },
        )
        const postPublishFailures = afterPublish.filter(
          (entries) => !entries.some((entry) => entry.path.replaceAll("\\", "/") === created),
        ).length
        if (postPublishFailures) throw new Error(`${postPublishFailures} post-publish queries missed the created file`)
        const idleStart = cpuUsage()
        yield* Effect.sleep("500 millis")
        return {
          before,
          loaded,
          firstResponseMs,
          firstResultCount: first.length,
          verifiedReadyMs,
          startupCpu,
          startupEventLoopLagMs,
          settleMs,
          batchQueries: batch.length,
          batchElapsedMs,
          batchCpu: batchCpuUsage,
          invalidBatch,
          top1Variants: top1.size,
          visibleAfterMs,
          postPublishQueries: afterPublish.length,
          postPublishFailures,
          idleCpu: cpu(idleStart),
          concurrencyPassed: true,
          peakRssSampled,
        }
      }
      if (option("probe", "") === "lifecycle") {
        const settleMs = Number(option("settle-ms", "0"))
        if (settleMs > 0) yield* Effect.sleep(settleMs)
        const created = "modules/aaa-fff-poc-created.ts"
        const renamed = "modules/aaa-fff-poc-renamed.ts"
        for (const name of [created, renamed]) {
          if (yield* Effect.promise(() => Bun.file(path.join(data.directory, name)).exists()))
            throw new Error(`Probe file already exists: ${name}; use a fresh fixture`)
        }
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const name of [created, renamed]) await fs.rm(path.join(data.directory, name), { force: true })
          }),
        )
        const events = []
        for (const action of ["create", "rename", "delete"] as const) {
          const started = performance.now()
          if (action === "create") yield* Effect.promise(() => Bun.write(path.join(data.directory, created), "probe\n"))
          if (action === "rename")
            yield* Effect.promise(() =>
              fs.rename(path.join(data.directory, created), path.join(data.directory, renamed)),
            )
          if (action === "delete") yield* Effect.promise(() => fs.unlink(path.join(data.directory, renamed)))
          let polls = 0
          while (true) {
            const paths = (yield* search.find({ query: "aaa-fff-poc", type: "file", limit: 50 })).map((entry) =>
              entry.path.replaceAll("\\", "/"),
            )
            polls++
            const visible =
              action === "create"
                ? paths.includes(created)
                : action === "rename"
                  ? paths.includes(renamed) && !paths.includes(created)
                  : !paths.includes(renamed) && !paths.includes(created)
            if (visible) {
              events.push({ action, visibleAfterMs: performance.now() - started, polls })
              break
            }
            if (performance.now() - started > 25_000) {
              events.push({ action, timeoutMs: performance.now() - started, polls })
              break
            }
            yield* Effect.sleep("100 millis")
          }
          if ("timeoutMs" in events.at(-1)!) break
        }
        return {
          before,
          loaded,
          firstResponseMs,
          firstResultCount: first.length,
          verifiedReadyMs,
          startupCpu,
          startupEventLoopLagMs,
          events,
          settleMs,
          lifecyclePassed: events.length === 3 && events.every((event) => !("timeoutMs" in event)),
          peakRssSampled,
        }
      }
      const answers: Array<{ query: Query; paths: string[] }> = []
      for (const query of data.queries) {
        const entries = yield* search.find(query)
        answers.push({ query, paths: entries.map((entry) => `${entry.type}:${entry.path.replaceAll("\\", "/")}`) })
      }
      // Compare the same eight queries that return a full top-50 on both engines.
      // Selective/Unicode/empty-query behavior is recorded separately above.
      const timedQueries: Query[] = workload === "typo"
        ? ["sesszon", "sesison", "proviider", "proivder", "renderre", "databzse", "workre", "markdwon"].map((query) => ({ query, type: "file", limit: 50 }))
        : data.queries.filter((_, index) => index < 7 || index === 13)
      const latency: number[] = []
      const perQuery = timedQueries.map(() => [] as number[])
      const perQueryCounts = timedQueries.map(() => [] as number[])
      const perQueryExpected = timedQueries.map(() => [] as number[])
      const typoFamilies = ["session", "session", "provider", "provider", "renderer", "database", "worker", "markdown"]
      const warmCpu = cpuUsage()
      const warmCycles = processMetrics?.cycles()
      const workerWarmCpu = workerProcesses.map((entry) => entry.metrics.cpu())
      const warmStart = performance.now()
      if (workerDiagnostics) {
        workerDiagnostics.cpuMicros = 0
        workerDiagnostics.nativeWallMicros = 0
        workerDiagnostics.nativeThreadCpuMicros = 0
      }
      const eventLoopLag: number[] = []
      let expectedTick = performance.now() + 5
      const eventLoopTimer = setInterval(() => {
        const now = performance.now()
        eventLoopLag.push(Math.max(0, now - expectedTick))
        expectedTick = now + 5
      }, 5)
      let returned = 0
      const rounds = Number(option("rounds", "60"))
      const queryDelayMs = Number(option("query-delay-ms", "0"))
      try {
        for (let round = 0; round < rounds; round++) {
          for (let index = 0; index < timedQueries.length; index++) {
            const query = timedQueries[(index + round) % timedQueries.length]!
            const mark = performance.now()
            const entries = yield* search.find(query)
            const elapsed = performance.now() - mark
            if (workload === "standard" && entries.length !== 50)
              throw new Error(`${backend}: timed query ${query.query} returned ${entries.length}, expected 50`)
            latency.push(elapsed)
            perQuery[(index + round) % timedQueries.length]!.push(elapsed)
            perQueryCounts[(index + round) % timedQueries.length]!.push(entries.length)
            if (workload === "typo") {
              const family = typoFamilies[(index + round) % timedQueries.length]!
              perQueryExpected[(index + round) % timedQueries.length]!.push(
                entries.filter((entry) => entry.type === "file" && path.basename(entry.path).startsWith(`${family}-component-`)).length,
              )
            }
            returned += entries.length
            if (queryDelayMs > 0) yield* Effect.sleep(`${queryDelayMs} millis`)
          }
          // Give native watchers and the process sampler an opportunity to run.
          yield* Effect.yieldNow
        }
      } finally {
        clearInterval(eventLoopTimer)
      }
      const warm = {
        wallMs: performance.now() - warmStart,
        cpu: cpu(warmCpu),
        processCycles: warmCycles === undefined ? undefined : Number(processMetrics!.cycles() - warmCycles),
        workerCpu: workerProcesses.length
          ? workerProcesses.reduce(
              (total, entry, index) => {
                const difference = cpuDifference(workerWarmCpu[index]!, entry.metrics.cpu())
                return {
                  userMs: total.userMs + difference.userMs,
                  systemMs: total.systemMs + difference.systemMs,
                  totalMs: total.totalMs + difference.totalMs,
                }
              },
              { userMs: 0, systemMs: 0, totalMs: 0 },
            )
          : undefined,
        workerBracketCpuMs: workerDiagnostics ? workerDiagnostics.cpuMicros / 1_000 : undefined,
        workerNativeWallMs: workerDiagnostics ? workerDiagnostics.nativeWallMicros / 1_000 : undefined,
        workerNativeThreadCpuMs: workerDiagnostics ? workerDiagnostics.nativeThreadCpuMicros / 1_000 : undefined,
        latencyMs: distribution(latency),
        eventLoopLagMs: distribution(eventLoopLag),
        queries: timedQueries,
        perQuery: perQuery.map(distribution),
        resultCounts: perQueryCounts.map((counts) => ({ min: Math.min(...counts), max: Math.max(...counts) })),
        expectedFamilyCounts: workload === "typo"
          ? perQueryExpected.map((counts) => ({ min: Math.min(...counts), max: Math.max(...counts) }))
          : undefined,
        returned,
      }
      const afterQueries = retained()
      const workerAfterQueries = workerProcesses.map((entry) => ({ pid: entry.pid, memory: entry.metrics.memory() }))
      const idleCpu = cpuUsage()
      yield* Effect.sleep("500 millis")
      return {
        before,
        loaded,
        afterQueries,
        workerLoaded,
        workerAfterQueries,
        firstResponseMs,
        firstResultCount: first.length,
        verifiedReadyMs,
        startupCpu,
        startupEventLoopLagMs,
        warm,
        idleCpu: cpu(idleCpu),
        answers,
        extraIndexed: extra,
        peakRssSampled,
      }
    }).pipe(Effect.provide(layer), Effect.provide(Logger.layer([Logger.map(Logger.formatStructured, (entry) => {
      if (Array.isArray(entry.message) && typeof entry.message[0] === "string" && entry.message[0].startsWith("native filename search") && entry.message[0].includes("legacy rollback")) productFallback = true
    })])), Effect.scoped),
  ).finally(() => {
    clearInterval(sampler)
    clearInterval(startupEventLoopTimer)
  })
  await Bun.sleep(100)
  if (backend === "product" && productFallback) throw new Error("Product selected legacy fallback during benchmark")
  return {
    backend,
    fixtureCount: data.count,
    fixtureHash: data.hash,
    ...result,
    afterDispose: retained(),
    children,
    processUsage: process.resourceUsage(),
    pid: process.pid,
    workerPids: workerDiagnostics ? [...workerDiagnostics.pids] : undefined,
    workerRuntimePids: workerDiagnostics ? [...workerDiagnostics.runtimePids] : undefined,
    nativeLoadDiagnostics,
    bun: Bun.version,
  }
}

if (backend) {
  if (!["ripgrep", "fff", "product", "nucleo", "nucleo-async", "nucleo-fallback", "nucleo-worker", "nucleo-napi", "nucleo-napi-sync"].includes(backend))
    throw new Error(`Unknown backend: ${backend}`)
  if (backend === "fff") {
    const { FileFinder } = await import("@ff-labs/fff-bun")
    if (!FileFinder.isAvailable())
      throw new Error("FFF unavailable; refusing to benchmark the fallback under the FFF label")
  }
  const data = (await Bun.file(option("fixture", "")).json()) as Fixture
  const cycles = Number(option("cycles", "1"))
  const result =
    cycles === 1
      ? await measure(data)
      : {
          cycles: await (async () => {
            const values = []
            for (let cycle = 0; cycle < cycles; cycle++) values.push({ cycle, ...(await measure(data)) })
            return values
          })(),
        }
  await Bun.write(option("result", ""), JSON.stringify(result, null, 2))
} else {
  await fs.mkdir(out, { recursive: true })
  const fff = engines.includes("fff") ? await import("@ff-labs/fff-bun") : undefined
  if (fff && !fff.FileFinder.isAvailable())
    throw new Error("Installed FFF native library is unavailable; no fallback benchmark is allowed")
  const binary = fff?.findBinary()
  const provenance = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    fffVersion: fff
      ? (await Bun.file(path.resolve(import.meta.dir, "../node_modules/@ff-labs/fff-bun/package.json")).json()).version
      : undefined,
    trackedFixture: args.includes("--tracked"),
    workload,
    shortLivedThreads: args.includes("--short-lived-threads"),
    cpuAccountingUncertain: args.includes("--cpu-accounting-uncertain"),
    fixtureRoot: path.resolve(option("fixture-root", out)),
    engines,
    nativeLibrary: option("native-lib", "") || undefined,
    nativeLibrarySha256: option("native-lib", "")
      ? createHash("sha256")
          .update(await Bun.file(option("native-lib", "")).bytes())
          .digest("hex")
      : undefined,
    napiLibrary: option("napi-lib", "") || undefined,
    napiLibrarySha256: option("napi-lib", "")
      ? createHash("sha256")
          .update(await Bun.file(option("napi-lib", "")).bytes())
          .digest("hex")
      : undefined,
    binary,
    binarySha256: binary
      ? createHash("sha256")
          .update(await Bun.file(binary).bytes())
          .digest("hex")
      : undefined,
    rg,
    rgVersion: Bun.spawnSync([rg, "--version"]).stdout.toString().split("\n")[0],
    head: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(),
    sourceHashes: Object.fromEntries(
      await Promise.all(
        [
          import.meta.filename,
          path.join(import.meta.dir, "file-search-benchmark-metrics.ts"),
          path.resolve(import.meta.dir, "../src/filesystem/search.ts"),
          path.resolve(import.meta.dir, "../src/filesystem/search-native.bun.ts"),
          path.resolve(import.meta.dir, "../src/filesystem/search-runtime-fallback.ts"),
          path.resolve(import.meta.dir, "../src/filesystem/fff.bun.ts"),
          path.join(import.meta.dir, "file-search-nucleo.ts"),
          path.join(import.meta.dir, "file-search-nucleo-fallback.ts"),
          path.join(import.meta.dir, "file-search-nucleo-worker.ts"),
          path.join(import.meta.dir, "file-search-nucleo-worker-thread.ts"),
          path.join(import.meta.dir, "file-search-nucleo-napi.ts"),
        ].map(async (file) => [
          file,
          createHash("sha256")
            .update(await Bun.file(file).bytes())
            .digest("hex"),
        ]),
      ),
    ),
    note: workload === "typo"
      ? "Diagnostic typo workload. Result counts and expected filename-family counts are recorded per query; engines may return different results. This workload cannot satisfy the standard performance gates."
      : "Source runtime on current working tree. Windows CPU uses GetProcessTimes (all threads); Windows memory uses K32GetProcessMemoryInfo. Child CPU/peaks are recorded separately where available. Fresh processes, OS file caches not flushed. Timed queries return top-50 on both engines; ranking/other semantics may differ.",
  }
  await Bun.write(path.join(out, "provenance.json"), JSON.stringify(provenance, null, 2))
  const sizes = option("sizes", "1000,10000,50000").split(",").map(Number)
  const runs = Number(option("runs", "5"))
  if (sizes.some((size) => !Number.isInteger(size) || size < 1_000))
    throw new Error("Sizes must be integers >= 1000 for the top-50 workload")
  if (!Number.isInteger(runs) || runs < 1) throw new Error("Runs must be a positive integer")
  const results = []
  for (const size of sizes) {
    const data = await fixture(size)
    console.log(`Fixture ready: ${size} + 4 Unicode/space cases`)
    for (let run = 0; run < runs; run++) {
      for (const engine of engines.map((_, index) => engines[(index + run) % engines.length]!)) {
        const target = path.join(out, `${size}-${run}-${engine}.json`)
        const child = Bun.spawn(
          [
            process.execPath,
            import.meta.filename,
            "--child",
            engine,
            "--fixture",
            path.join(data.directory, "fixture.json"),
            "--result",
            target,
            "--rounds",
            option("rounds", "60"),
            "--query-delay-ms",
            option("query-delay-ms", "0"),
            "--workload",
            workload,
            "--probe",
            option("probe", ""),
            "--settle-ms",
            option("settle-ms", "0"),
            "--native-lib",
            option("native-lib", ""),
            "--napi-lib",
            option("napi-lib", ""),
          ],
          { stdout: "pipe", stderr: "pipe" },
        )
        const timeout = setTimeout(() => child.kill(), 120_000)
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        clearTimeout(timeout)
        if (code !== 0) throw new Error(`${engine}/${size}/${run} exited ${code}: ${stderr}\n${stdout}`)
        const result = await Bun.file(target).json()
        results.push({ run, ...result })
        console.log(
          JSON.stringify({
            size,
            run,
            backend: engine,
            readyMs: result.verifiedReadyMs,
            p95Ms: result.warm?.latencyMs.p95,
            cpuMs: result.warm?.cpu.totalMs,
            events: result.events,
            loadedRssMiB: result.loaded.rss / 1024 / 1024,
          }),
        )
        await Bun.sleep(250)
      }
    }
  }
  await Bun.write(path.join(out, "results.json"), JSON.stringify({ provenance, results }, null, 2))
  console.log(`Raw results: ${out}`)
}
