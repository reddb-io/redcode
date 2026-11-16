// Isolated lookup only; never starts Azure CLI or reads credentials.
import { which } from "../src/util/which"

const samples = { current: [] as number[], bun: [] as number[] }
const results = { current: [] as (string | null)[], bun: [] as (string | null)[] }
for (let i = 0; i < 30; i++) {
  for (const engine of i % 2 === 0 ? (["current", "bun"] as const) : (["bun", "current"] as const)) {
    const start = performance.now()
    const result = engine === "current" ? which("az") : Bun.which("az")
    samples[engine].push(performance.now() - start)
    results[engine].push(result)
  }
}
const percentile = (values: number[], fraction: number) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
console.log(JSON.stringify({
  platform: process.platform,
  bun: Bun.version,
  iterations: samples.current.length,
  agrees: results.current.every((result, index) => result === results.bun[index]),
  found: results.current[0] !== null,
  milliseconds: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  }])),
}, null, 2))
