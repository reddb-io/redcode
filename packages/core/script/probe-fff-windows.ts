/** Diagnose native readiness and watcher lifecycle on a generated benchmark fixture. */
import fs from "node:fs/promises"
import path from "node:path"
import { FileFinder } from "@ff-labs/fff-bun"
import { openProcessMetrics } from "./file-search-benchmark-metrics"

const args = process.argv.slice(2)
const option = (key: string, fallback: string) => {
  const index = args.indexOf(`--${key}`)
  return index < 0 ? fallback : (args[index + 1] ?? fallback)
}
const directory = path.resolve(option("fixture", ""))
const manifest = await Bun.file(path.join(directory, "fixture.json")).json()
const metrics = openProcessMetrics(process.pid)
if (!metrics) throw new Error("Windows process counters are unavailable")
const names = [
  "modules/aaa-native-early-probe.ts",
  "modules/aaa-native-late-probe.ts",
  "modules/aaa-native-renamed-probe.ts",
]
for (const name of names)
  if (await Bun.file(path.join(directory, name)).exists()) throw new Error(`Probe file already exists: ${name}`)
const start = performance.now()
const result = FileFinder.create({
  basePath: directory,
  aiMode: true,
  disableMmapCache: true,
  disableContentIndexing: true,
})
if (!result.ok) throw new Error(result.error)
const finder = result.value
const samples = []
const events = []
let earlyWritten = false
let watcherReadyMs: number | undefined
let beforeCpu = metrics.cpu()
const visible = (name: string) => {
  const found = finder.fileSearch(path.basename(name), { pageSize: 50 })
  if (!found.ok) throw new Error(found.error)
  return found.value.items.some((item) => item.relativePath.replaceAll("\\", "/") === name)
}
async function waitFor(name: string, present: boolean, timeout = 5_000) {
  const started = performance.now()
  while (visible(name) !== present && performance.now() - started < timeout) await Bun.sleep(100)
  return { visible: visible(name), expectedPresent: present, elapsedMs: performance.now() - started }
}
try {
  while (performance.now() - start < 35_000) {
    const progress = finder.getScanProgress()
    if (!progress.ok) throw new Error(progress.error)
    const current = metrics.cpu()
    samples.push({
      elapsedMs: performance.now() - start,
      progress: progress.value,
      cpuMs: (current.user + current.system - beforeCpu.user - beforeCpu.system) / 1_000,
      memory: metrics.memory(),
    })
    beforeCpu = current
    if (
      option("early", "true") === "true" &&
      !earlyWritten &&
      progress.value.scannedFilesCount >= manifest.files.length
    ) {
      await Bun.write(path.join(directory, names[0]!), "early\n")
      events.push({ action: "create-before-watcher-check", atMs: performance.now() - start, progress: progress.value })
      earlyWritten = true
    }
    if (progress.value.isWatcherReady) {
      watcherReadyMs = performance.now() - start
      break
    }
    await Bun.sleep(100)
  }
  if (earlyWritten) events.push({ action: "early-visibility", ...(await waitFor(names[0]!, true)) })
  beforeCpu = metrics.cpu()
  for (let second = 0; second < 5; second++) {
    await Bun.sleep(1_000)
    const current = metrics.cpu()
    samples.push({
      elapsedMs: performance.now() - start,
      idlePhase: "before-late-mutations",
      idleSecond: second,
      progress: finder.getScanProgress(),
      cpuMs: (current.user + current.system - beforeCpu.user - beforeCpu.system) / 1_000,
      memory: metrics.memory(),
    })
    beforeCpu = current
  }
  await Bun.write(path.join(directory, names[1]!), "late\n")
  events.push({ action: "create-after-watcher-wait", ...(await waitFor(names[1]!, true)) })
  await fs.rename(path.join(directory, names[1]!), path.join(directory, names[2]!))
  events.push({ action: "rename", ...(await waitFor(names[2]!, true)), oldPathVisible: visible(names[1]!) })
  await fs.unlink(path.join(directory, names[2]!))
  events.push({ action: "delete", ...(await waitFor(names[2]!, false)) })
  if (option("rescan", "true") === "true") {
    const rescan = finder.scanFiles()
    const rescanned = await finder.waitForScan(10_000)
    events.push({ action: "manual-rescan", rescan, rescanned, earlyVisible: visible(names[0]!) })
  }
  beforeCpu = metrics.cpu()
  for (let second = 0; second < 10; second++) {
    await Bun.sleep(1_000)
    const current = metrics.cpu()
    samples.push({
      elapsedMs: performance.now() - start,
      idlePhase: "after-late-mutations",
      idleSecond: second,
      progress: finder.getScanProgress(),
      cpuMs: (current.user + current.system - beforeCpu.user - beforeCpu.system) / 1_000,
      memory: metrics.memory(),
    })
    beforeCpu = current
  }
} finally {
  finder.destroy()
  for (const name of names) await fs.rm(path.join(directory, name), { force: true })
}
Bun.gc(true)
await Bun.sleep(1_000)
const output = {
  early: option("early", "true"),
  rescan: option("rescan", "true"),
  directory,
  fileCount: manifest.files.length,
  watcherReadyMs,
  events,
  samples,
  afterDestroy: metrics.memory(),
}
await Bun.write(option("result", path.join(directory, "../fff-native-probe.json")), JSON.stringify(output, null, 2))
console.log(
  JSON.stringify({
    fileCount: output.fileCount,
    watcherReadyMs,
    events,
    idleCpuMs: samples.filter((item) => "idleSecond" in item).map((item) => item.cpuMs),
  }),
)
metrics.close()
