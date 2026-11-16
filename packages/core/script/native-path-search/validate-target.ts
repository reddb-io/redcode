/** Run the complete single-host validation sequence for one native package target. */
import path from "node:path"

const args = process.argv.slice(2)
const option = (key: string, fallback?: string) => {
  const index = args.indexOf(`--${key}`)
  const value = index < 0 ? fallback : args[index + 1]
  if (!value) throw new Error(`missing --${key}`)
  return value
}
const target = option("target")
const outputRoot = path.resolve(option("out"))
const cargoTarget = path.resolve(option("cargo-target"))
const fixture = path.resolve(
  option("contract", path.resolve(import.meta.dir, "../../test/fixture/filesystem-search-contract.json")),
)
const core = path.resolve(import.meta.dir, "../..")
const repository = path.resolve(option("ranking-directory", path.resolve(core, "../..")))
const packageDirectory = path.join(outputRoot, "native-packages", target)
const performanceDirectory = path.join(outputRoot, `${target}-performance`)
const lifecycleDirectory = path.join(outputRoot, `${target}-lifecycle`)
const fixtureRoot = path.resolve(option("fixture-root", path.join(outputRoot, "fixtures")))
const skipPerformance = args.includes("--skip-performance")
const allowShort = args.includes("--allow-short")
const baseline = option("baseline", "ripgrep")
if (baseline !== "ripgrep" && baseline !== "fff") throw new Error("--baseline must be ripgrep or fff")
const runs = Number(option("runs", "5"))
const soakMs = Number(option("soak-ms", "0"))
if (!Number.isInteger(runs) || runs < 1 || (!skipPerformance && runs < 5 && !allowShort))
  throw new Error("--runs must be an integer >= 5; use --allow-short only for a non-promotable smoke")
if (!Number.isInteger(soakMs) || soakMs < 0 || (soakMs > 0 && soakMs < 60_000))
  throw new Error("--soak-ms must be zero or an integer >= 60000")
if (!skipPerformance && await Bun.file(path.join(performanceDirectory, "provenance.json")).exists())
  throw new Error(`performance output already exists; choose a fresh --out directory: ${performanceDirectory}`)

async function run(command: string[], cwd = import.meta.dir) {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) throw new Error(`${command.join(" ")} exited ${code}`)
}

await run([
  process.execPath,
  path.join(import.meta.dir, "package-native.ts"),
  "--target",
  target,
  "--out",
  path.join(outputRoot, "native-packages"),
  "--cargo-target",
  cargoTarget,
])
const manifestPath = path.join(packageDirectory, "manifest.json")
const manifest = (await Bun.file(manifestPath).json()) as {
  runtimeSmoke: boolean
  filename: string
  sha256: string
}
if (!manifest.runtimeSmoke)
  throw new Error(`target ${target} was built on an incompatible host; runtime validation is required`)
const library = path.join(packageDirectory, manifest.filename)
const contractPath = path.join(packageDirectory, "contract-smoke.json")
await run([
  process.execPath,
  path.join(import.meta.dir, "smoke-native.ts"),
  "--lib",
  library,
  "--fixture",
  fixture,
  "--out",
  contractPath,
])
const contract = (await Bun.file(contractPath).json()) as { passed: boolean; library: { sha256: string } }
if (!contract.passed || contract.library.sha256 !== manifest.sha256)
  throw new Error(`contract smoke did not validate packaged hash ${manifest.sha256}`)

let performance: unknown
let ranking: unknown
let lifecycle: unknown
let soak: unknown
if (!skipPerformance) {
  const rankingPath = path.join(packageDirectory, "ranking.json")
  await run(
    [
      process.execPath,
      path.join(core, "script", "validate-file-search-ranking.ts"),
      "--directory",
      repository,
      "--native-lib",
      library,
      "--baseline",
      baseline,
      "--out",
      rankingPath,
    ],
    core,
  )
  ranking = await Bun.file(rankingPath).json()
  if (!(ranking as { passed?: boolean }).passed) throw new Error(`ranking validation failed for ${target}`)

  await run(
    [
      process.execPath,
      path.join(core, "script", "benchmark-file-search.ts"),
      "--out",
      lifecycleDirectory,
      "--fixture-root",
      path.join(fixtureRoot, "lifecycle"),
      "--sizes",
      "10000",
      "--runs",
      "1",
      "--engines",
      "product",
      "--probe",
      "lifecycle",
      "--native-lib",
      library,
    ],
    core,
  )
  const lifecyclePath = path.join(lifecycleDirectory, "10000-0-product.json")
  lifecycle = await Bun.file(lifecyclePath).json()
  if (!(lifecycle as { lifecyclePassed?: boolean }).lifecyclePassed)
    throw new Error(`lifecycle validation failed for ${target}`)

  await run(
    [
      process.execPath,
      path.join(core, "script", "benchmark-file-search.ts"),
      "--out",
      performanceDirectory,
      "--fixture-root",
      fixtureRoot,
      "--sizes",
      "50000",
      "--runs",
      String(runs),
      "--engines",
      `${baseline},product`,
      "--rounds",
      option("rounds", "80"),
      "--query-delay-ms",
      option("query-delay-ms", "50"),
      "--native-lib",
      library,
    ],
    core,
  )
  const summaryPath = path.join(performanceDirectory, "summary.json")
  await run([
    process.execPath,
    path.join(core, "script", "summarize-file-search-benchmark.ts"),
    "--input",
    performanceDirectory,
    "--out",
    summaryPath,
    "--baseline",
    baseline,
  ])
  performance = await Bun.file(summaryPath).json()
  const measured = performance as { passed?: boolean; summaries?: Array<{ size: number; backend: string; runs: number[] }> }
  if (!measured.passed) throw new Error(`performance gates failed for ${target}`)
  const expectedRuns = Array.from({ length: runs }, (_, index) => index).join(",")
  for (const backend of [baseline, "product"]) {
    const samples = measured.summaries?.find((item) => item.size === 50_000 && item.backend === backend)
    if (!samples || samples.runs.join(",") !== expectedRuns)
      throw new Error(`unexpected ${backend} samples for ${target}; expected ${expectedRuns}`)
  }

  if (soakMs > 0) {
    const soakDirectory = path.join(outputRoot, `${target}-soak`)
    await run(
      [
        process.execPath,
        path.join(core, "script", "benchmark-file-search.ts"),
        "--out",
        soakDirectory,
        "--fixture-root",
        path.join(fixtureRoot, "soak"),
        "--sizes",
        "10000",
        "--runs",
        "1",
        "--engines",
        "product",
        "--probe",
        "soak",
        "--soak-ms",
        String(soakMs),
        "--native-lib",
        library,
      ],
      core,
    )
    const soakPath = path.join(soakDirectory, "10000-0-product.json")
    soak = await Bun.file(soakPath).json()
    if (!(soak as { soakPassed?: boolean }).soakPassed) throw new Error(`soak validation failed for ${target}`)
  }
}

const report = {
  formatVersion: 1,
  target,
  baseline,
  packageDirectory,
  manifest,
  contract,
  ranking,
  lifecycle,
  performance,
  soak,
  smokePassed: true,
  passed: !skipPerformance && runs >= 5,
}
await Bun.write(path.join(packageDirectory, "target-validation.json"), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      target,
      sha256: manifest.sha256,
      contract: contract.passed,
      ranking: skipPerformance ? false : true,
      lifecycle: skipPerformance ? false : true,
      performance: !skipPerformance,
      soak: !skipPerformance && soakMs > 0,
    },
    null,
    2,
  ),
)
