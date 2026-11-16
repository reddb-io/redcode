/** Summarize raw benchmark samples without discarding outliers. */
import path from "node:path"
import { mkdir } from "node:fs/promises"

const args = process.argv.slice(2)
const option = (key: string) => {
  const index = args.indexOf(`--${key}`)
  const value = index < 0 ? undefined : args[index + 1]
  if (!value) throw new Error(`missing --${key}`)
  return path.resolve(value)
}
const input = option("input")
const output = option("out")
const baselineIndex = args.indexOf("--baseline")
const baselineName = baselineIndex < 0 ? "ripgrep" : args[baselineIndex + 1]
if (baselineName !== "ripgrep" && baselineName !== "fff") throw new Error("--baseline must be ripgrep or fff")
const provenance = await Bun.file(path.join(input, "provenance.json")).exists()
  ? await Bun.file(path.join(input, "provenance.json")).json()
  : undefined
if (provenance?.workload === "typo") throw new Error("typo workload is diagnostic and cannot satisfy the standard performance gates")
if (provenance?.shortLivedThreads || provenance?.cpuAccountingUncertain || await Bun.file(path.join(input, "cpu-accounting-invalid.json")).exists())
  throw new Error("CPU time accounting is unreliable for this workload; standard performance gates are disabled")
if (provenance?.platform === "win32")
  throw new Error("Windows CPU time accounting is not validated for bursty workloads; standard performance gates are disabled")

type Sample = {
  backend: string
  verifiedReadyMs: number
  loaded: { rss: number }
  warm: {
    cpu: { totalMs: number }
    latencyMs: { count: number; p50: number; p95: number; p99: number }
    returned: number
  }
}

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}
const distribution = (values: number[]) => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) })
const groups = new Map<string, Array<Sample & { run: number; filename: string }>>()
const glob = new Bun.Glob("*.json")
for await (const filename of glob.scan({ cwd: input, onlyFiles: true })) {
  const match = /^(\d+)-(\d+)-(.+)\.json$/.exec(filename)
  if (!match) continue
  const sample = (await Bun.file(path.join(input, filename)).json()) as Sample
  const key = `${match[1]}:${sample.backend}`
  const group = groups.get(key) ?? []
  group.push({ ...sample, run: Number(match[2]), filename })
  groups.set(key, group)
}
if (groups.size === 0) throw new Error(`no raw benchmark samples in ${input}`)

const summaries = [...groups.entries()]
  .map(([key, samples]) => {
    const [size, backend] = key.split(":")
    const runs = samples.map((sample) => sample.run).toSorted((a, b) => a - b)
    const queryCounts = [...new Set(samples.map((sample) => sample.warm.latencyMs.count))]
    const returned = [...new Set(samples.map((sample) => sample.warm.returned))]
    return {
      size: Number(size),
      backend,
      runs,
      files: samples.map((sample) => sample.filename).toSorted(),
      workload: { queryCounts, returned, consistent: queryCounts.length === 1 && returned.length === 1 },
      readyMs: distribution(samples.map((sample) => sample.verifiedReadyMs)),
      loadedRssMiB: distribution(samples.map((sample) => sample.loaded.rss / 1024 / 1024)),
      warmP50Ms: distribution(samples.map((sample) => sample.warm.latencyMs.p50)),
      warmP95Ms: distribution(samples.map((sample) => sample.warm.latencyMs.p95)),
      warmP99Ms: distribution(samples.map((sample) => sample.warm.latencyMs.p99)),
      warmCpuMs: distribution(samples.map((sample) => sample.warm.cpu.totalMs)),
    }
  })
  .toSorted((a, b) => a.size - b.size || a.backend.localeCompare(b.backend))

const percent = (value: number, baseline: number) => baseline > 0 ? ((value / baseline) - 1) * 100 : null
const comparisons = summaries
  .filter((summary) => summary.backend !== baselineName)
  .map((summary) => {
    const baseline = summaries.find((candidate) => candidate.size === summary.size && candidate.backend === baselineName)
    if (!baseline) throw new Error(`missing ${baselineName} baseline for ${summary.size}`)
    if (baseline.runs.join() !== summary.runs.join()) throw new Error(`run mismatch for ${summary.size}/${summary.backend}`)
    if (!baseline.workload.consistent || !summary.workload.consistent) throw new Error(`inconsistent workload for ${summary.size}`)
    if (baseline.workload.queryCounts[0] !== summary.workload.queryCounts[0])
      throw new Error(`query-count mismatch for ${summary.size}/${summary.backend}`)
    if (baseline.workload.returned[0] !== summary.workload.returned[0])
      throw new Error(`returned-result mismatch for ${summary.size}/${summary.backend}`)
    const medianChangePercent = {
      readyMs: percent(summary.readyMs.median, baseline.readyMs.median),
      loadedRssMiB: percent(summary.loadedRssMiB.median, baseline.loadedRssMiB.median),
      warmP50Ms: percent(summary.warmP50Ms.median, baseline.warmP50Ms.median),
      warmP95Ms: percent(summary.warmP95Ms.median, baseline.warmP95Ms.median),
      warmP99Ms: percent(summary.warmP99Ms.median, baseline.warmP99Ms.median),
      warmCpuMs: percent(summary.warmCpuMs.median, baseline.warmCpuMs.median),
    }
    const gates = {
      readyMs: { actual: medianChangePercent.readyMs, maximum: 5, passed: medianChangePercent.readyMs !== null && medianChangePercent.readyMs <= 5 },
      loadedRssMiB: {
        actual: medianChangePercent.loadedRssMiB,
        maximum: -25,
        passed: medianChangePercent.loadedRssMiB !== null && medianChangePercent.loadedRssMiB <= -25,
      },
      warmP50Ms: {
        actualPercent: medianChangePercent.warmP50Ms,
        actualAbsoluteMs: summary.warmP50Ms.median - baseline.warmP50Ms.median,
        maximumPercent: 5,
        maximumAbsoluteMs: 1,
        passed:
          (medianChangePercent.warmP50Ms !== null && medianChangePercent.warmP50Ms <= 5) || summary.warmP50Ms.median - baseline.warmP50Ms.median <= 1,
      },
      efficiency: {
        warmCpuMs: medianChangePercent.warmCpuMs,
        warmP95Ms: medianChangePercent.warmP95Ms,
        maximumEither: -20,
        passed: (medianChangePercent.warmCpuMs !== null && medianChangePercent.warmCpuMs <= -20) ||
          (medianChangePercent.warmP95Ms !== null && medianChangePercent.warmP95Ms <= -20),
      },
    }
    return {
      size: summary.size,
      baseline: baselineName,
      contender: summary.backend,
      medianChangePercent,
      gates,
      passed: Object.values(gates).every((gate) => gate.passed),
    }
  })

const report = {
  formatVersion: 2,
  input,
  provenance,
  summaries,
  comparisons,
  passed: comparisons.length > 0 && comparisons.every((comparison) => comparison.passed),
}
await mkdir(path.dirname(output), { recursive: true })
await Bun.write(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ summaries, comparisons }, null, 2))
