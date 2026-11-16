/**
 * Differential ranking validation on a real repository. Paths and generated
 * queries are hashed in the output; only the fixed common queries are retained.
 * --include-common-paths opts into recording paths for ranking diagnosis.
 * This script never connects to providers or changes the repository under test.
 */
import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, Layer, Logger } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileSystemSearch } from "../src/filesystem/search"
import { Environment } from "../src/environment"
import { Location } from "../src/location"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { AbsolutePath } from "../src/schema"
import { location } from "../test/fixture/location"
import { nucleoAsyncLayer } from "./file-search-nucleo"

const args = process.argv.slice(2)
const option = (key: string, fallback: string) => {
  const index = args.indexOf(`--${key}`)
  return index < 0 ? fallback : (args[index + 1] ?? fallback)
}

const directory = path.resolve(option("directory", process.cwd()))
const nativeLibrary = path.resolve(option("native-lib", ""))
const output = path.resolve(option("out", "file-search-ranking.json"))
const baseline = option("baseline", "ripgrep")
const fffThreads = Number(option("fff-threads", "0"))
const fffFullyReady = args.includes("--fff-ready")
if (!Number.isInteger(fffThreads) || fffThreads < 0 || fffThreads > 256) throw new Error("--fff-threads must be 0..256")
if (baseline !== "ripgrep" && baseline !== "fff") throw new Error("--baseline must be ripgrep or fff")
if (baseline === "fff") {
  const { FileFinder } = await import("@ff-labs/fff-bun")
  if (!FileFinder.isAvailable()) throw new Error("FFF unavailable; refusing to validate a fallback as FFF")
}
const sampleFileCount = Number(option("sample-files", "150"))
const sampleDirectoryCount = Number(option("sample-directories", "50"))
const rg = Bun.which("rg")
if (!rg) throw new Error("ripgrep is required")
if (!nativeLibrary || !(await Bun.file(nativeLibrary).exists())) throw new Error("--native-lib must point to the PoC library")
if (!Number.isInteger(sampleFileCount) || sampleFileCount < 1) throw new Error("--sample-files must be positive")
if (!Number.isInteger(sampleDirectoryCount) || sampleDirectoryCount < 1)
  throw new Error("--sample-directories must be positive")

const listed = Bun.spawn([rg, "--files"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
const [listedCode, listedStdout, listedStderr] = await Promise.all([
  listed.exited,
  new Response(listed.stdout).text(),
  new Response(listed.stderr).text(),
])
if (listedCode !== 0) throw new Error(`ripgrep exited ${listedCode}: ${listedStderr}`)
const files = listedStdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"))
  .toSorted()
if (!files.length) throw new Error("repository has no searchable files")

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const anonymize = (value: string) => digest(value).slice(0, 16)
const deterministicSample = (values: string[], count: number) =>
  values
    .map((value) => ({ value, order: digest(value) }))
    .toSorted((a, b) => a.order.localeCompare(b.order))
    .slice(0, count)
    .map((entry) => entry.value)

const directories = [
  ...new Set(
    files.flatMap((file) => {
      const parts = file.split("/")
      return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
    }),
  ),
].toSorted()
const basenameCounts = new Map<string, number>()
const stemCounts = new Map<string, number>()
for (const file of files) {
  const basename = path.posix.basename(file)
  const stem = basename.replace(/\.[^.]+$/, "")
  basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
  stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1)
}

type Intent = {
  id: string
  category: "exact_path" | "unique_basename" | "unique_stem" | "parent_stem" | "exact_directory" | "common" | "typo_insert" | "typo_substitute" | "typo_transpose"
  query: string
  type: "file" | "directory"
  expected?: string
}

const sampledFiles = deterministicSample(files, sampleFileCount)
const intents: Intent[] = []
for (const [index, file] of sampledFiles.entries()) {
  const basename = path.posix.basename(file)
  const stem = basename.replace(/\.[^.]+$/, "")
  const parent = path.posix.basename(path.posix.dirname(file))
  intents.push({ id: `exact_path:${index}`, category: "exact_path", query: file, type: "file", expected: file })
  if (basenameCounts.get(basename) === 1)
    intents.push({
      id: `unique_basename:${index}`,
      category: "unique_basename",
      query: basename,
      type: "file",
      expected: file,
    })
  if (stem.length >= 3 && stemCounts.get(stem) === 1)
    intents.push({ id: `unique_stem:${index}`, category: "unique_stem", query: stem, type: "file", expected: file })
  if (args.includes("--diagnose-typos") && /^[a-z]{6,}$/i.test(stem) && stemCounts.get(stem) === 1) {
    const offset = Math.floor(stem.length / 2)
    const replacement = stem[offset]!.toLowerCase() === "z" ? "x" : "z"
    intents.push({ id: `typo_insert:${index}`, category: "typo_insert", query: stem.slice(0, offset) + "z" + stem.slice(offset), type: "file", expected: file })
    intents.push({ id: `typo_substitute:${index}`, category: "typo_substitute", query: stem.slice(0, offset) + replacement + stem.slice(offset + 1), type: "file", expected: file })
    if (stem[offset]!.toLowerCase() !== stem[offset + 1]!.toLowerCase())
      intents.push({ id: `typo_transpose:${index}`, category: "typo_transpose", query: stem.slice(0, offset) + stem[offset + 1]! + stem[offset]! + stem.slice(offset + 2), type: "file", expected: file })
  }
  if (parent.length >= 3 && stem.length >= 3 && parent !== ".")
    intents.push({
      id: `parent_stem:${index}`,
      category: "parent_stem",
      query: `${parent} ${stem}`,
      type: "file",
      expected: file,
    })
}
for (const [index, expected] of deterministicSample(directories, sampleDirectoryCount).entries())
  intents.push({
    id: `exact_directory:${index}`,
    category: "exact_directory",
    query: expected,
    type: "directory",
    expected,
  })
for (const query of [
  "session",
  "provider",
  "filesystem",
  "renderer",
  "protocol",
  "database",
  "worker",
  "markdown",
  "composer",
  "server",
  "memory",
  "search",
])
  intents.push({ id: `common:${query}`, category: "common", query, type: "file" })

const local = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const driver = Environment.makeLocalDriver(spawner)
    return Environment.Service.of({ spawner, files: Environment.makeFiles(driver) })
  }),
).pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node)))
const ripgrep = LayerNode.compile(Ripgrep.node, {
  replacements: [
    Environment.node.replace(local),
    RipgrepBinary.node.replace(Layer.succeed(RipgrepBinary.Service, { filepath: Effect.succeed(rg) })),
  ],
})
const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location(ref, {
      vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) },
    }),
  ),
)

const run = (selected: Layer.Layer<FileSystemSearch.Service, never, Location.Service | Ripgrep.Service>, waitForFff = false, collectCandidates = false) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* FileSystemSearch.Service
      if (waitForFff) {
        // FFF initializes asynchronously. Require every sampled exact file before
        // measuring ranking; otherwise an incomplete scan would look like a parity failure.
        const deadline = performance.now() + 30_000
        for (const file of sampledFiles) {
          const shortQuery = path.posix.basename(file).split(/[.\[\]]/)[0]!
          while (true) {
            const entries = yield* service.find({ query: file, type: "file", limit: 50 })
            if (entries.some((entry) => entry.path.replaceAll("\\", "/") === file)) break
            const shorter = shortQuery ? yield* service.find({ query: shortQuery, type: "file", limit: 50 }) : []
            if (shorter.some((entry) => entry.path.replaceAll("\\", "/") === file)) break
            if (performance.now() >= deadline) {
              throw new Error(`FFF did not expose a sampled file before the readiness deadline: ${args.includes("--include-common-paths") ? JSON.stringify(file) : anonymize(file)}`)
            }
            yield* Effect.sleep("50 millis")
          }
        }
      }
      const started = performance.now()
      const answers = []
      for (const intent of intents) {
        const entries = yield* service.find({ query: intent.query, type: intent.type, limit: 50 })
        const paths = entries.map((entry) => entry.path.replaceAll("\\", "/").replace(/\/$/, ""))
        answers.push({ paths, wrongType: entries.some((entry) => entry.type !== intent.type), duplicate: new Set(paths).size !== paths.length })
      }
      const elapsedMs = performance.now() - started
      const commonCandidates: Record<string, string[]> = {}
      if (collectCandidates) {
        const limit = files.length + directories.length + 1
        for (const intent of intents.filter((item) => item.category === "common")) {
          const entries = yield* service.find({ query: intent.query, type: "file", limit })
          if (entries.length >= limit) throw new Error("candidate limit reached; cannot establish complete candidate coverage")
          commonCandidates[intent.query] = entries.map((entry) => entry.path.replaceAll("\\", "/").replace(/\/$/, ""))
        }
      }
      return { answers, elapsedMs, commonCandidates }
    }).pipe(
      Effect.provide(selected.pipe(Layer.provide(ripgrep), Layer.provide(locationLayer))),
      Effect.provide(Logger.layer([])),
      Effect.scoped,
    ),
  )

const legacy = await run(baseline === "fff" ? FileSystemSearch.makeFffLayer({ maxThreads: fffThreads, waitForIndexReady: fffFullyReady }) : FileSystemSearch.ripgrepLayer, baseline === "fff")
const rust = await run(nucleoAsyncLayer(nativeLibrary), false, args.includes("--diagnose-common-candidates"))
const rank = (paths: string[], expected: string) => {
  const index = paths.indexOf(expected)
  return index < 0 ? undefined : index + 1
}
const overlap = (left: string[], right: string[], limit: number) => {
  const a = new Set(left.slice(0, limit))
  const b = new Set(right.slice(0, limit))
  const denominator = Math.min(a.size, b.size)
  if (denominator === 0) return a.size === b.size ? 1 : 0
  return [...a].filter((value) => b.has(value)).length / denominator
}
const percentile = (values: number[], fraction: number) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}
const fixed = intents.map((intent, index) => {
  const current = legacy.answers[index]!
  const candidate = rust.answers[index]!
  return {
    id: intent.id,
    category: intent.category,
    query: intent.category === "common" ? intent.query : undefined,
    queryHash: intent.category === "common" ? undefined : anonymize(intent.query),
    expectedHash: intent.expected ? anonymize(intent.expected) : undefined,
    legacyRank: intent.expected ? rank(current.paths, intent.expected) : undefined,
    rustRank: intent.expected ? rank(candidate.paths, intent.expected) : undefined,
    legacyCount: current.paths.length,
    rustCount: candidate.paths.length,
    top1Agreement: current.paths[0] === candidate.paths[0],
    top10Overlap: overlap(current.paths, candidate.paths, 10),
    top50Overlap: overlap(current.paths, candidate.paths, 50),
    violation: current.wrongType || current.duplicate || candidate.wrongType || candidate.duplicate,
  }
})
const expected = fixed.filter((item) => item.expectedHash)
const legacyTop10 = expected.filter((item) => item.legacyRank !== undefined && item.legacyRank <= 10)
const preservedTop10 = legacyTop10.filter((item) => item.rustRank !== undefined && item.rustRank <= 10)
const lostTop50 = legacyTop10.filter((item) => item.rustRank === undefined || item.rustRank > 50)
const exactHard = expected.filter(
  (item) =>
    (item.category === "exact_path" || item.category === "unique_basename") &&
    item.legacyRank === 1 &&
    (item.rustRank === undefined || item.rustRank > 10),
)
const exactCoverage = expected.filter(
  (item) =>
    (item.category === "exact_path" || item.category === "exact_directory") &&
    (item.legacyRank === undefined || item.rustRank === undefined),
)
const common = fixed.filter((item) => item.category === "common" && (item.legacyCount > 0 || item.rustCount > 0))
const contractViolations = fixed.filter((item) => item.violation)
const top10Retention = legacyTop10.length ? preservedTop10.length / legacyTop10.length : 1
const commonTop10Median = percentile(
  common.map((item) => item.top10Overlap),
  0.5,
)
const commonTop50Median = percentile(
  common.map((item) => item.top50Overlap),
  0.5,
)
const gates = {
  top10Retention: { actual: top10Retention, minimum: 0.99, passed: top10Retention >= 0.99 },
  lostTop50: { actual: lostTop50.length, maximum: 0, passed: lostTop50.length === 0 },
  commonTop10Median: { actual: commonTop10Median, minimum: 0.5, passed: commonTop10Median >= 0.5 },
  commonTop50Median: { actual: commonTop50Median, minimum: 0.7, passed: commonTop50Median >= 0.7 },
  commonComparable: { actual: common.length, minimum: 6, passed: common.length >= 6 },
  exactHard: { actual: exactHard.length, maximum: 0, passed: exactHard.length === 0 },
  exactCoverage: { actual: exactCoverage.length, maximum: 0, passed: exactCoverage.length === 0 },
  contractViolations: { actual: contractViolations.length, maximum: 0, passed: contractViolations.length === 0 },
}
const categories = Object.fromEntries(
  [...new Set(fixed.map((item) => item.category))].map((category) => {
    const items = fixed.filter((item) => item.category === category)
    return [
      category,
      {
        count: items.length,
        expectedTop10Legacy: items.filter((item) => item.expectedHash && item.legacyRank !== undefined && item.legacyRank <= 10).length,
        expectedTop10Rust: items.filter((item) => item.expectedHash && item.rustRank !== undefined && item.rustRank <= 10).length,
        top1Agreement: items.filter((item) => item.top1Agreement).length / items.length,
        top10OverlapMedian: percentile(
          items.map((item) => item.top10Overlap),
          0.5,
        ),
        top50OverlapMedian: percentile(
          items.map((item) => item.top50Overlap),
          0.5,
        ),
      },
    ]
  }),
)
const result = {
  date: new Date().toISOString(),
  repositoryHash: anonymize(directory),
  head: Bun.spawnSync(["git", "-C", directory, "rev-parse", "HEAD"]).stdout.toString().trim(),
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
  baseline,
  fffConfiguration: baseline === "fff" ? { maxThreads: fffThreads, waitForIndexReady: fffFullyReady } : undefined,
  promotionEligible: baseline !== "fff" || (fffThreads === 0 && !fffFullyReady),
  rgVersion: Bun.spawnSync([rg, "--version"]).stdout.toString().split("\n")[0],
  sourceSha256: {
    validator: digest(await Bun.file(import.meta.filename).text()),
    strictAdapter: digest(await Bun.file(path.join(import.meta.dir, "file-search-nucleo.ts")).text()),
    nativeAdapter: digest(await Bun.file(path.resolve(import.meta.dir, "../src/filesystem/search-native.bun.ts")).text()),
    legacy: digest(await Bun.file(path.resolve(import.meta.dir, "../src/filesystem/search.ts")).text()),
    contract: digest(await Bun.file(path.resolve(import.meta.dir, "../src/filesystem/search-contract.ts")).text()),
  },
  rustLibrarySha256: createHash("sha256").update(await Bun.file(nativeLibrary).bytes()).digest("hex"),
  corpus: {
    files: files.length,
    directories: directories.length,
    sampleFiles: sampledFiles.length,
    sha256: digest(files.join("\n")),
  },
  intents: {
    count: intents.length,
    sha256: digest(JSON.stringify(intents.map(({ category, query, type, expected }) => ({ category, query, type, expected })))),
  },
  elapsedMs: { legacy: legacy.elapsedMs, rust: rust.elapsedMs },
  baselineAnswersSha256: digest(JSON.stringify(legacy.answers)),
  rustAnswersSha256: digest(JSON.stringify(rust.answers)),
  gates,
  passed: Object.values(gates).every((gate) => gate.passed),
  categories,
  candidateCoverage: args.includes("--diagnose-common-candidates")
    ? intents.flatMap((intent, index) => {
        if (intent.category !== "common") return []
        const baselinePaths = legacy.answers[index]!.paths
        const inventory = new Set(files)
        const comparable = baselinePaths.filter((entry) => inventory.has(entry))
        const candidates = new Set(rust.commonCandidates[intent.query]!)
        return [{
          query: intent.query,
          baselineTop50: baselinePaths.length,
          outsideRipgrepInventory: baselinePaths.length - comparable.length,
          baselineInInventory: comparable.length,
          presentAnywhereInRust: comparable.filter((entry) => candidates.has(entry)).length,
          rustCandidateCount: candidates.size,
        }]
      })
    : undefined,
  answerHashes: args.includes("--include-answer-hashes")
    ? intents.map((intent, index) => ({ id: intent.id, category: intent.category, baseline: digest(JSON.stringify(legacy.answers[index])), rust: digest(JSON.stringify(rust.answers[index])) }))
    : undefined,
  commonPaths: args.includes("--include-common-paths")
    ? intents.flatMap((intent, index) =>
        intent.category === "common"
          ? [{ query: intent.query, legacy: legacy.answers[index]!.paths, rust: rust.answers[index]!.paths }]
          : [],
      )
    : undefined,
  failures: fixed
    .filter(
      (item) =>
        item.violation ||
        lostTop50.includes(item) ||
        exactHard.includes(item) ||
        exactCoverage.includes(item) ||
        (item.category === "common" && (item.top10Overlap < 0.5 || item.top50Overlap < 0.7)),
    )
    .map((item) => ({
      id: item.id,
      category: item.category,
      query: item.query,
      queryHash: item.queryHash,
      expectedHash: item.expectedHash,
      legacyRank: item.legacyRank,
      rustRank: item.rustRank,
      legacyCount: item.legacyCount,
      rustCount: item.rustCount,
      top10Overlap: item.top10Overlap,
      top50Overlap: item.top50Overlap,
      violation: item.violation,
    })),
}
await Bun.write(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ output, passed: result.passed, promotionEligible: result.promotionEligible, corpus: result.corpus, intents: result.intents, gates }, null, 2))
if (!result.passed) process.exitCode = 1
