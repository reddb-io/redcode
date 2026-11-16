/** Compare FFF's complete glob inventory with rg without writing repository paths. */
import { createHash } from "node:crypto"
import path from "node:path"
import { FileFinder } from "@ff-labs/fff-bun"

const args = process.argv.slice(2)
const required = (name: string) => {
  const index = args.indexOf(`--${name}`)
  if (index < 0 || !args[index + 1]) throw new Error(`missing --${name}`)
  return path.resolve(args[index + 1]!)
}
const directory = required("directory")
const output = required("out")
const rg = Bun.which("rg")
if (!rg || !FileFinder.isAvailable()) throw new Error("ripgrep and FFF are required")
const listing = Bun.spawn([rg, "--files"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
const [code, stdout, stderr] = await Promise.all([listing.exited, new Response(listing.stdout).text(), new Response(listing.stderr).text()])
if (code !== 0) throw new Error(`ripgrep exited ${code}: ${stderr}`)
const paths = stdout.split(/\r?\n/).filter(Boolean).map((entry) => entry.replaceAll("\\", "/")).toSorted()
const inventory = new Set(paths)
const created = FileFinder.create({ basePath: directory, aiMode: true, disableMmapCache: true, disableContentIndexing: true })
if (!created.ok) throw new Error(`FFF initialization failed: ${created.error}`)
try {
  const ready = await created.value.waitForIndexReady(30_000)
  if (!ready.ok || !ready.value) throw new Error(`FFF readiness failed: ${ready.ok ? "timeout" : ready.error}`)
  await Bun.sleep(1000)
  const progress = created.value.getScanProgress()
  if (!progress.ok) throw new Error(`FFF progress failed: ${progress.error}`)
  const found = new Set<string>()
  const page = created.value.glob("**/*", { pageIndex: 0, pageSize: progress.value.scannedFilesCount + 1, maxThreads: 1 })
  if (!page.ok) throw new Error(`FFF glob failed: ${page.error}`)
  if (page.value.items.length !== page.value.totalMatched) throw new Error("FFF glob did not return the entire inventory")
  for (const item of page.value.items) {
    const normalized = item.relativePath.replaceAll("\\", "/")
    if (found.has(normalized)) throw new Error("FFF glob produced duplicate paths")
    found.add(normalized)
  }
  const classify = (items: string[]) => ({
    count: items.length,
    gitMetadata: items.filter((entry) => entry === ".git" || entry.startsWith(".git/")).length,
    otherHidden: items.filter((entry) => !entry.startsWith(".git/") && entry.split("/").some((part) => part.startsWith("."))).length,
    other: items.filter((entry) => !entry.split("/").some((part) => part.startsWith("."))).length,
  })
  const fffOnly = [...found].filter((entry) => !inventory.has(entry))
  const rgOnly = paths.filter((entry) => !found.has(entry))
  const result = {
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    fffVersion: (await Bun.file(path.resolve(import.meta.dir, "../node_modules/@ff-labs/fff-bun/package.json")).json()).version,
    validatorSha256: createHash("sha256").update(await Bun.file(import.meta.filename).text()).digest("hex"),
    corpus: { count: paths.length, sha256: createHash("sha256").update(paths.join("\n")).digest("hex") },
    progress: progress.value,
    fffGlobCount: found.size,
    common: paths.length - rgOnly.length,
    fffOnly: classify(fffOnly),
    rgOnly: classify(rgOnly),
    note: "FFF glob inventory is requested in one complete page; results depend on glob semantics and reported readiness.",
  }
  await Bun.write(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  created.value.destroy()
}
