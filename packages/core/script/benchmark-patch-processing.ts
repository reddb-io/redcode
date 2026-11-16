/** Baseline PATCH-002 before admitting a Rust rewrite. */
import path from "node:path"
import os from "node:os"
import { mkdir } from "node:fs/promises"
import { Patch } from "@opencode/util/patch"
import { VcsPatch } from "../src/vcs/patch.js"

const args = process.argv.slice(2)
const value = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`)
  const result = index < 0 ? fallback : args[index + 1]
  if (!result) throw new Error(`missing --${name}`)
  return result
}
const output = path.resolve(value("out"))
const sizes = value("sizes", "100000,1000000,10000000")
  .split(",")
  .map(Number)
const requestedRuns = Number(value("runs", "7"))
if (sizes.some((size) => !Number.isInteger(size) || size < 1) || !Number.isInteger(requestedRuns) || requestedRuns < 1)
  throw new Error("sizes and runs must be positive integers")

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function vcsFixture(bytes: number) {
  const chunks: string[] = []
  let index = 0
  let total = 0
  while (total < bytes) {
    const file = `src/generated/file-${index++}.ts`
    const chunk = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,2 +1,2 @@\n-export const value = ${index}\n+export const value = ${index + 1}\n context\n`
    chunks.push(chunk)
    total += Buffer.byteLength(chunk)
  }
  return { text: chunks.join(""), truncated: false } satisfies VcsPatch.Patch
}

function toolFixture(bytes: number) {
  const lines: string[] = []
  let index = 0
  let total = 0
  while (total < bytes) {
    const line = `export const value${index} = ${index++}`
    lines.push(line)
    total += Buffer.byteLength(line) + 1
  }
  const middle = Math.floor(lines.length / 2)
  const before = lines[middle]!
  const after = `${before} + 1`
  const patch = [
    "*** Begin Patch",
    "*** Update File: fixture.ts",
    `@@ ${lines[middle - 1]}`,
    `-${before}`,
    `+${after}`,
    "*** End Patch",
  ].join("\n")
  return { original: `${lines.join("\n")}\n`, patch }
}

function measure<T>(runs: number, operation: () => T) {
  operation()
  const wallMs: number[] = []
  const cpuMs: number[] = []
  const rssMiB: number[] = []
  for (let run = 0; run < runs; run++) {
    Bun.gc(true)
    const rss = process.memoryUsage.rss()
    const cpu = process.cpuUsage()
    const started = performance.now()
    const result = operation()
    if (result === undefined) throw new Error("operation returned undefined")
    wallMs.push(performance.now() - started)
    const used = process.cpuUsage(cpu)
    cpuMs.push((used.user + used.system) / 1000)
    rssMiB.push((process.memoryUsage.rss() - rss) / 1024 / 1024)
  }
  return {
    runs,
    wallMs: { median: median(wallMs), min: Math.min(...wallMs), max: Math.max(...wallMs) },
    cpuMs: { median: median(cpuMs), min: Math.min(...cpuMs), max: Math.max(...cpuMs) },
    rssDeltaMiB: { median: median(rssMiB), min: Math.min(...rssMiB), max: Math.max(...rssMiB) },
  }
}

const results = sizes.map((size) => {
  const vcs = vcsFixture(size)
  const tool = toolFixture(size)
  const parsed = Patch.parse(tool.patch)
  if (parsed._tag !== "Success") throw parsed.failure
  const update = parsed.success[0]
  if (!update || update.type !== "update") throw new Error("fixture did not produce an update hunk")
  const runs = size >= 10_000_000 ? Math.min(requestedRuns, 3) : requestedRuns
  return {
    requestedBytes: size,
    vcsBytes: Buffer.byteLength(vcs.text),
    toolSourceBytes: Buffer.byteLength(tool.original),
    toolPatchBytes: Buffer.byteLength(tool.patch),
    runs,
    vcsCount: measure(runs, () => VcsPatch.countPatch(vcs.text)),
    vcsSplit: measure(runs, () => VcsPatch.splitGitPatch(vcs)),
    vcsMap: measure(runs, () => VcsPatch.chunksByFile(vcs, () => undefined)),
    toolParse: measure(runs, () => Patch.parse(tool.patch)),
    toolDerive: measure(runs, () => Patch.derive("fixture.ts", update.chunks, tool.original)),
  }
})

const report = {
  formatVersion: 1,
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
  cpu: os.cpus()[0]?.model,
  results,
}
await mkdir(path.dirname(output), { recursive: true })
await Bun.write(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
