/** Diagnose inventory differences in a local opt-in ranking report without recording paths. */
import { createHash } from "node:crypto"
import path from "node:path"

const args = process.argv.slice(2)
const required = (key: string) => {
  const index = args.indexOf(`--${key}`)
  if (index < 0 || !args[index + 1]) throw new Error(`missing --${key}`)
  return path.resolve(args[index + 1]!)
}
const directory = required("directory")
const input = required("input")
const output = required("out")
const report = await Bun.file(input).json() as {
  baseline: string
  corpus: { sha256: string }
  commonPaths?: Array<{ query: string; legacy: string[]; rust: string[] }>
}
if (report.baseline !== "fff" || !report.commonPaths?.length) throw new Error("input must contain FFF common paths")
const rg = Bun.which("rg")
if (!rg) throw new Error("ripgrep is required")
const listed = Bun.spawn([rg, "--files"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
const [code, stdout, stderr] = await Promise.all([listed.exited, new Response(listed.stdout).text(), new Response(listed.stderr).text()])
if (code !== 0) throw new Error(`ripgrep exited ${code}: ${stderr}`)
const files = stdout.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/")).toSorted()
const hash = createHash("sha256").update(files.join("\n")).digest("hex")
if (hash !== report.corpus.sha256) throw new Error("corpus changed since the ranking report; refusing comparison")
const inventory = new Set(files)
const overlap = (left: string[], right: string[]) => {
  const a = new Set(left)
  const b = new Set(right)
  const denominator = Math.min(a.size, b.size)
  return denominator ? [...a].filter((item) => b.has(item)).length / denominator : a.size === b.size ? 1 : 0
}
const queries = report.commonPaths.map(({ query, legacy, rust }) => {
  const inInventory = legacy.filter((file) => inventory.has(file))
  return {
    query,
    fffCount: legacy.length,
    fffOutsideRipgrepInventory: legacy.length - inInventory.length,
    rustOutsideRipgrepInventory: rust.filter((file) => !inventory.has(file)).length,
    originalTop50Overlap: overlap(legacy, rust),
    filteredFffCount: inInventory.length,
    filteredOverlap: overlap(inInventory, rust),
  }
})
const result = {
  corpusSha256: hash,
  fileCount: files.length,
  rankingReportSha256: createHash("sha256").update(await Bun.file(input).bytes()).digest("hex"),
  note: "FFF results are filtered after top-50 truncation; filtered overlap is diagnostic, not an acceptance gate or a comparison of complete inventories.",
  queries,
}
await Bun.write(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
