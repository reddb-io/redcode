/** Diagnostic only: compare FFF rankings after the native index reports full readiness. */
import { createHash } from "node:crypto"
import path from "node:path"
import { FileFinder } from "@ff-labs/fff-bun"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const offset = args.indexOf(`--${name}`)
  return offset < 0 ? fallback : (args[offset + 1] ?? fallback)
}
const directory = path.resolve(option("directory", process.cwd()))
const output = path.resolve(option("out", "fff-ranking-stability.json"))
const instances = Number(option("instances", "3"))
const repetitions = Number(option("repetitions", "3"))
const settleMs = Number(option("settle-ms", "0"))
const maxThreads = Number(option("max-threads", "0"))
if (!Number.isInteger(instances) || instances < 2 || !Number.isInteger(repetitions) || repetitions < 2)
  throw new Error("instances and repetitions must be integers >= 2")
if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 30_000) throw new Error("settle-ms must be 0..30000")
if (!Number.isInteger(maxThreads) || maxThreads < 0 || maxThreads > 256) throw new Error("max-threads must be 0..256")
if (!FileFinder.isAvailable()) throw new Error("FFF unavailable")

const digest = (input: string) => createHash("sha256").update(input).digest("hex")
const rg = Bun.which("rg")
if (!rg) throw new Error("ripgrep is required to fingerprint the corpus")
const listing = Bun.spawn([rg, "--files"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
const [listingCode, listingOutput, listingError] = await Promise.all([
  listing.exited,
  new Response(listing.stdout).text(),
  new Response(listing.stderr).text(),
])
if (listingCode !== 0) throw new Error(`ripgrep exited ${listingCode}: ${listingError}`)
const corpus = listingOutput.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/")).toSorted()
const fffPackage = await Bun.file(path.resolve(import.meta.dir, "../node_modules/@ff-labs/fff-bun/package.json")).json()
const queries = ["session", "provider", "filesystem", "renderer", "protocol", "database", "worker", "markdown", "composer", "server", "memory", "search"]
const results: Array<Array<Array<{ paths: string[]; tiedAdjacent: number; totalMatched: number }>>> = []
const progress = []
const roundProgress = []
for (let instance = 0; instance < instances; instance++) {
  const created = FileFinder.create({ basePath: directory, aiMode: true, disableMmapCache: true, disableContentIndexing: true })
  if (!created.ok) throw new Error(`FFF initialization failed: ${created.error}`)
  try {
    const ready = await created.value.waitForIndexReady(30_000)
    if (!ready.ok || !ready.value) throw new Error(`FFF full index readiness failed: ${ready.ok ? "timeout" : ready.error}`)
    if (settleMs) await Bun.sleep(settleMs)
    const state = created.value.getScanProgress()
    if (!state.ok) throw new Error(`FFF progress failed: ${state.error}`)
    progress.push(state.value)
    const rounds = []
    const states = []
    for (let round = 0; round < repetitions; round++) {
      const answers = []
      for (const query of queries) {
        const found = created.value.fileSearch(query, { pageIndex: 0, pageSize: 50, maxThreads })
        if (!found.ok) throw new Error(`FFF search failed: ${found.error}`)
        const items = found.value.items.map((item, index) => ({ path: item.relativePath.replaceAll("\\", "/"), score: found.value.scores[index]?.total ?? 0 }))
          .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
        answers.push({
          paths: items.map((item) => item.path),
          tiedAdjacent: items.filter((item, index) => index > 0 && item.score === items[index - 1]!.score && item.path.length === items[index - 1]!.path.length).length,
          totalMatched: found.value.totalMatched,
        })
      }
      rounds.push(answers)
      const after = created.value.getScanProgress()
      if (!after.ok) throw new Error(`FFF progress failed: ${after.error}`)
      states.push(after.value)
    }
    results.push(rounds)
    roundProgress.push(states)
  } finally {
    created.value.destroy()
  }
}

const overlap = (left: string[], right: string[]) => {
  const a = new Set(left)
  const b = new Set(right)
  const size = Math.min(a.size, b.size)
  return size ? [...a].filter((item) => b.has(item)).length / size : a.size === b.size ? 1 : 0
}
const diagnostics = queries.map((query, index) => {
  const first = results[0]![0]![index]!
  const across = results.slice(1).map((rounds) => rounds[0]![index]!)
  const within = results.flatMap((rounds) => rounds.slice(1).map((round) => ({ initial: rounds[0]![index]!, later: round[index]! })))
  return {
    query,
    initialResultHash: digest(JSON.stringify(first.paths)),
    withinSameInstance: within.map(({ initial, later }) => ({ sameOrder: JSON.stringify(initial.paths) === JSON.stringify(later.paths), overlap: overlap(initial.paths, later.paths) })),
    acrossInstances: across.map((other) => ({ sameOrder: JSON.stringify(first.paths) === JSON.stringify(other.paths), overlap: overlap(first.paths, other.paths) })),
    tiedAdjacent: results.map((rounds) => rounds[0]![index]!.tiedAdjacent),
    totalMatched: results.map((rounds) => rounds[0]![index]!.totalMatched),
    totalMatchedByRound: results.map((rounds) => rounds.map((round) => round[index]!.totalMatched)),
  }
})
const report = {
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
  fffVersion: fffPackage.version,
  validatorSha256: digest(await Bun.file(import.meta.filename).text()),
  directoryHash: digest(directory),
  corpus: { files: corpus.length, sha256: digest(corpus.join("\n")) },
  instances,
  repetitions,
  settleMs,
  maxThreads,
  progress,
  roundProgress,
  diagnostics,
}
await Bun.write(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, progress, diagnostics }, null, 2))
