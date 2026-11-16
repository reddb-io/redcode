/** Native SDK experiments, separate from the production-layer comparison.
 * Reuses generated benchmark fixtures. Run each sample in a fresh process.
 * --mode search|lifecycle|memory; --variants auto-watch,auto-manual,one-manual,two-manual
 * --early-release permits disposal before the native watcher is ready (memory mode).
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { FileFinder, findBinary } from "@ff-labs/fff-bun"
import { openProcessMetrics } from "./file-search-benchmark-metrics"

const args = process.argv.slice(2)
const option = (key: string, fallback: string) => {
  const index = args.indexOf(`--${key}`)
  return index < 0 ? fallback : (args[index + 1] ?? fallback)
}
const configurations = {
  "auto-watch": { disableWatch: false, maxThreads: 0 },
  "auto-manual": { disableWatch: true, maxThreads: 0 },
  "one-manual": { disableWatch: true, maxThreads: 1 },
  "two-manual": { disableWatch: true, maxThreads: 2 },
}
const mode = option("mode", "search")
const variant = option("child", "") as keyof typeof configurations | ""
const out = path.resolve(option("out", "fff-options-results"))
const metrics = openProcessMetrics(process.pid)
if (!metrics) throw new Error("This diagnostic requires Windows process counters")
const processMetrics = metrics
function memory() {
  Bun.gc(true)
  Bun.gc(true)
  return { ...process.memoryUsage(), windows: processMetrics.memory() }
}
function cpu(before: NodeJS.CpuUsage) {
  const current = processMetrics.cpu()
  return (current.user + current.system - before.user - before.system) / 1_000
}
function distribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
  return { count: values.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) }
}
async function ready(finder: FileFinder, count: number, watcher: boolean) {
  const started = performance.now()
  while (true) {
    const progress = finder.getScanProgress()
    if (!progress.ok) throw new Error(progress.error)
    if (
      !progress.value.isScanning &&
      progress.value.isWarmupComplete &&
      progress.value.scannedFilesCount >= count &&
      (!watcher || progress.value.isWatcherReady)
    )
      return progress.value
    if (performance.now() - started > 30_000)
      throw new Error(`FFF readiness timeout: ${JSON.stringify(progress.value)}`)
    await Bun.sleep(10)
  }
}
async function idle(seconds: number) {
  const samples = []
  for (let second = 0; second < seconds; second++) {
    const before = processMetrics.cpu()
    const mark = performance.now()
    await Bun.sleep(1_000)
    samples.push({ cpuMs: cpu(before), wallMs: performance.now() - mark })
  }
  return samples
}

if (variant) {
  if (!(variant in configurations)) throw new Error(`Unknown variant: ${variant}`)
  const configuration = configurations[variant]
  const data = (await Bun.file(option("fixture", "")).json()) as {
    directory: string
    files: string[]
    count: number
    hash: string
    queries: Array<{ query: string; type?: "file" | "directory"; limit: number }>
  }
  const baseline = memory()
  const cycles = []
  const cycleCount = mode === "memory" ? Number(option("cycles", "16")) : 1
  for (let cycle = 0; cycle < cycleCount; cycle++) {
    const probePaths = ["modules/aaa-options-created.ts", "modules/aaa-options-renamed.ts"]
    if (mode === "lifecycle") {
      for (const name of probePaths)
        if (await Bun.file(path.join(data.directory, name)).exists())
          throw new Error(`Probe path already exists: ${name}`)
    }
    const started = performance.now()
    const startedCpu = processMetrics.cpu()
    const created = FileFinder.create({
      basePath: data.directory,
      aiMode: true,
      disableMmapCache: true,
      disableContentIndexing: true,
      disableWatch: configuration.disableWatch,
      logFilePath: args.includes("--native-log") ? option("result", "") + ".log" : undefined,
      logLevel: "info",
    })
    if (!created.ok) throw new Error(created.error)
    const finder = created.value
    const events = []
    const before = memory()
    const progress = await ready(
      finder,
      data.files.length,
      !configuration.disableWatch && !args.includes("--early-release"),
    )
    const readyMs = performance.now() - started
    const startupCpuMs = cpu(startedCpu)
    const loaded = memory()
    const queries = data.queries.filter((_, index) => index < 7 || index === 13)
    const search = (query: (typeof queries)[number]) => {
      const options = { pageSize: query.limit, pageIndex: 0, maxThreads: configuration.maxThreads }
      const found =
        query.type === "directory"
          ? finder.directorySearch(query.query, options)
          : finder.fileSearch(query.query, options)
      if (!found.ok) throw new Error(found.error)
      return found.value.items.map((item) => item.relativePath.replaceAll("\\", "/"))
    }
    const measurements: Record<string, unknown> = {}
    try {
      if (mode === "search") {
        await Bun.sleep(1_000)
        const answers = queries.map((query) => ({ query, paths: search(query) }))
        const times = queries.map(() => [] as number[])
        const markCpu = processMetrics.cpu()
        const mark = performance.now()
        for (let round = 0; round < Number(option("rounds", "120")); round++) {
          for (let index = 0; index < queries.length; index++) {
            const position = (round + index) % queries.length
            const now = performance.now()
            const paths = search(queries[position]!)
            times[position]!.push(performance.now() - now)
            if (paths.length !== 50) throw new Error("Timed query did not return 50 paths")
          }
          await Bun.sleep(0)
        }
        measurements.search = {
          wallMs: performance.now() - mark,
          cpuMs: cpu(markCpu),
          latencyMs: distribution(times.flat()),
          perQuery: times.map(distribution),
          answers,
        }
        measurements.afterQueries = memory()
        measurements.idle = await idle(1)
      }
      if (mode === "lifecycle") {
        measurements.beforeChanges = await idle(5)
        for (const action of ["create", "rename", "delete"] as const) {
          const markCpu = processMetrics.cpu()
          const mark = performance.now()
          if (action === "create") await Bun.write(path.join(data.directory, probePaths[0]!), "probe\n")
          if (action === "rename")
            await fs.rename(path.join(data.directory, probePaths[0]!), path.join(data.directory, probePaths[1]!))
          if (action === "delete") await fs.unlink(path.join(data.directory, probePaths[1]!))
          if (configuration.disableWatch) {
            await Bun.sleep(Number(option("debounce-ms", "200")))
            const scanned = finder.scanFiles()
            if (!scanned.ok) throw new Error(scanned.error)
            await ready(finder, data.files.length, false)
          }
          while (true) {
            const paths = search({ query: "aaa-options", type: "file", limit: 50 })
            const visible =
              action === "create"
                ? paths.includes(probePaths[0]!)
                : action === "rename"
                  ? paths.includes(probePaths[1]!) && !paths.includes(probePaths[0]!)
                  : !paths.includes(probePaths[0]!) && !paths.includes(probePaths[1]!)
            if (visible) {
              events.push({ action, wallMs: performance.now() - mark, cpuMs: cpu(markCpu) })
              break
            }
            if (performance.now() - mark > 10_000) throw new Error(`${action} visibility timeout`)
            await Bun.sleep(10)
          }
        }
        measurements.events = events
        measurements.afterChanges = await idle(Number(option("idle-seconds", "10")))
        measurements.afterChangesMemory = memory()
      }
      if (mode === "memory") {
        const paths = search(queries[0]!)
        if (paths.length !== 50) throw new Error("Memory probe expected top-50 results")
      }
    } finally {
      finder.destroy()
      if (mode === "lifecycle")
        for (const name of probePaths) await fs.rm(path.join(data.directory, name), { force: true })
    }
    await Bun.sleep(500)
    cycles.push({ cycle, before, loaded, progress, readyMs, startupCpuMs, ...measurements, afterDispose: memory() })
  }
  const settling = []
  for (let second = 0; second < Number(option("after-cycles-seconds", "0")); second++) {
    const before = processMetrics.cpu()
    await Bun.sleep(1_000)
    settling.push({ second, cpuMs: cpu(before), memory: memory() })
  }
  const result = {
    date: new Date().toISOString(),
    sourceSha256: createHash("sha256")
      .update(await Bun.file(import.meta.filename).bytes())
      .digest("hex"),
    variant,
    configuration,
    mode,
    binary: findBinary(),
    binarySha256: createHash("sha256")
      .update(await Bun.file(findBinary()!).bytes())
      .digest("hex"),
    count: data.count,
    fixtureHash: data.hash,
    baseline,
    earlyRelease: args.includes("--early-release"),
    cycles,
    settling,
  }
  await Bun.write(option("result", ""), JSON.stringify(result, null, 2))
} else {
  if (!["search", "lifecycle", "memory"].includes(mode)) throw new Error(`Unknown mode: ${mode}`)
  const root = path.resolve(option("fixture-root", ""))
  const sizes = option("sizes", "1000,10000,50000").split(",").map(Number)
  const variants = option("variants", Object.keys(configurations).join(",")).split(",")
  await fs.mkdir(out, { recursive: true })
  const provenance = {
    date: new Date().toISOString(),
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256: createHash("sha256")
      .update(await Bun.file(import.meta.filename).bytes())
      .digest("hex"),
    fffVersion: (await Bun.file(path.resolve(import.meta.dir, "../node_modules/@ff-labs/fff-bun/package.json")).json())
      .version,
    mode,
    note: "Direct native SDK, not the production Effect layer. No full-corpus result materialization. Search waits for scanner/warmup/watcher readiness, then one second. CPU includes all process threads. Lifecycle manual mode simulates a 200 ms coalescing window and explicit rescan; it is not yet integrated with the RedCode file watcher.",
  }
  const results = []
  for (const size of sizes) {
    for (let run = 0; run < Number(option("runs", "3")); run++) {
      const order = variants.map((_, index) => variants[(index + run) % variants.length]!)
      for (const engine of order) {
        const file = path.join(out, `${size}-${run}-${engine}.json`)
        if (args.includes("--resume") && (await Bun.file(file).exists())) {
          const previous = await Bun.file(file).json()
          if (previous.variant !== engine || previous.mode !== mode || previous.count !== size)
            throw new Error("Resume input does not match the recorded sample")
          results.push({ run, resumed: true, ...previous })
          continue
        }
        const child = Bun.spawn(
          [
            process.execPath,
            import.meta.filename,
            "--child",
            engine,
            "--mode",
            mode,
            "--fixture",
            path.join(root, `fixture-${size}`, "fixture.json"),
            "--result",
            file,
            "--rounds",
            option("rounds", "120"),
            "--cycles",
            option("cycles", "16"),
            "--idle-seconds",
            option("idle-seconds", "10"),
            "--after-cycles-seconds",
            option("after-cycles-seconds", "0"),
            ...(args.includes("--early-release") ? ["--early-release"] : []),
            ...(args.includes("--native-log") ? ["--native-log"] : []),
          ],
          { stdout: "pipe", stderr: "pipe" },
        )
        const timeout = setTimeout(() => child.kill(), 180_000)
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        clearTimeout(timeout)
        if (code !== 0) {
          const failure = {
            variant: engine,
            mode,
            count: size,
            status: "failed",
            exitCode: code,
            error: `${stderr}\n${stdout}`,
          }
          await Bun.write(file, JSON.stringify(failure, null, 2))
          results.push({ run, ...failure })
          await Bun.write(path.join(out, "results.json"), JSON.stringify({ provenance, results }, null, 2))
          console.log(JSON.stringify({ size, run, variant: engine, status: "failed", error: stderr.slice(0, 900) }))
          continue
        }
        const result = await Bun.file(file).json()
        results.push({ run, ...result })
        await Bun.write(path.join(out, "results.json"), JSON.stringify({ provenance, results }, null, 2))
        const first = result.cycles[0]
        console.log(
          JSON.stringify({
            size,
            run,
            variant: engine,
            mode,
            p95: first.search?.latencyMs.p95,
            cpuMs: first.search?.cpuMs,
            loadedMiB: first.loaded.rss / 1024 / 1024,
            events: first.events,
            idleCpuMs: first.afterChanges?.map((value: { cpuMs: number }) => value.cpuMs),
            releasedMiB: result.cycles.at(-1).afterDispose.rss / 1024 / 1024,
          }),
        )
      }
    }
  }
  await Bun.write(path.join(out, "results.json"), JSON.stringify({ provenance, results }, null, 2))
}
processMetrics.close()
