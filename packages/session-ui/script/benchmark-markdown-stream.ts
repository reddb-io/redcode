/** Baseline MD-003: measure growing prose versus the existing incremental code-fence fast path. */
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { project, type Projection } from "../src/components/markdown-stream.js"

const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`)
  const result = index < 0 ? fallback : args[index + 1]
  if (!result) throw new Error(`missing --${name}`)
  return result
}
const output = path.resolve(option("out"))
const sizes = option("sizes", "10000,100000,500000").split(",").map(Number)
const chunk = Number(option("chunk", "256"))
if (sizes.some((size) => !Number.isInteger(size) || size < 1) || !Number.isInteger(chunk) || chunk < 1)
  throw new Error("sizes and chunk must be positive integers")

const proseUnit = "## Heading\n\nA paragraph with **strong text**, a [link](https://example.com), and `inline code`.\n\n"
const codeUnit = "const value = compute(input)\n"
const fill = (unit: string, bytes: number, prefix = "") =>
  (prefix + unit.repeat(Math.ceil((bytes - prefix.length) / unit.length))).slice(0, bytes)

function run(text: string, incremental: boolean) {
  Bun.gc(true)
  const rss = process.memoryUsage.rss()
  const cpu = process.cpuUsage()
  const started = performance.now()
  let previous: Projection | undefined
  let maximumStepMs = 0
  let steps = 0
  for (let end = chunk; end < text.length + chunk; end += chunk) {
    const step = performance.now()
    previous = project(incremental ? previous : undefined, text.slice(0, Math.min(end, text.length)), true)
    maximumStepMs = Math.max(maximumStepMs, performance.now() - step)
    steps++
  }
  const used = process.cpuUsage(cpu)
  return {
    steps,
    wallMs: performance.now() - started,
    cpuMs: (used.user + used.system) / 1000,
    maximumStepMs,
    rssDeltaMiB: (process.memoryUsage.rss() - rss) / 1024 / 1024,
    blocks: previous?.blocks.length ?? 0,
  }
}

const results = sizes.map((size) => {
  const prose = fill(proseUnit, size)
  const code = fill(codeUnit, size, "```ts\n")
  return {
    bytes: size,
    chunk,
    proseIncremental: run(prose, true),
    proseStateless: run(prose, false),
    codeIncremental: run(code, true),
    codeStateless: run(code, false),
  }
})

const report = {
  formatVersion: 1,
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
  results,
}
await mkdir(path.dirname(output), { recursive: true })
await Bun.write(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
