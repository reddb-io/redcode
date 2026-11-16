import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const runner = path.resolve(import.meta.dir, "../../script/native-path-search/validate-target.ts")
const summarizer = path.resolve(import.meta.dir, "../../script/summarize-file-search-benchmark.ts")

test("rejects short or previously populated performance runs before building", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-validation-gate-"))
  const base = [process.execPath, runner, "--target", "windows-x64", "--out", root, "--cargo-target", path.join(root, "cargo")]
  const short = Bun.spawnSync([...base, "--runs", "1"], { stdout: "pipe", stderr: "pipe" })
  expect(short.exitCode).not.toBe(0)
  expect(short.stderr.toString()).toContain("--runs must be an integer >= 5")
  await Bun.write(path.join(root, "windows-x64-performance", "provenance.json"), "{}")
  const stale = Bun.spawnSync(base, { stdout: "pipe", stderr: "pipe" })
  expect(stale.exitCode).not.toBe(0)
  expect(stale.stderr.toString()).toContain("performance output already exists")
})

test("uses the requested FFF baseline and rejects missing baselines", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-baseline-gate-"))
  const sample = (backend: string, scale: number) => ({
    backend, verifiedReadyMs: 100 * scale, loaded: { rss: 200_000_000 * scale },
    warm: { cpu: { totalMs: 100 * scale }, latencyMs: { count: 10, p50: 10 * scale, p95: 20 * scale, p99: 25 * scale }, returned: 500 },
  })
  await Bun.write(path.join(root, "50000-0-fff.json"), JSON.stringify(sample("fff", 1)))
  await Bun.write(path.join(root, "50000-0-product.json"), JSON.stringify(sample("product", 0.5)))
  const output = path.join(root, "summary.json")
  const args = [process.execPath, summarizer, "--input", root, "--out", output]
  const missing = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" })
  expect(missing.exitCode).not.toBe(0)
  expect(missing.stderr.toString()).toContain("missing ripgrep baseline")
  const result = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode).toBe(0)
  const report = await Bun.file(output).json()
  expect(report.comparisons[0].baseline).toBe("fff")
  expect(report.comparisons[0].contender).toBe("product")
  expect(report.passed).toBe(true)
  const zero = sample("fff", 1)
  zero.warm.cpu.totalMs = 0
  zero.warm.latencyMs.p95 = 0
  await Bun.write(path.join(root, "50000-0-fff.json"), JSON.stringify(zero))
  const zeroResult = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(zeroResult.exitCode).toBe(0)
  const unavailable = await Bun.file(output).json()
  expect(unavailable.comparisons[0].medianChangePercent.warmCpuMs).toBeNull()
  expect(unavailable.comparisons[0].gates.efficiency.passed).toBe(false)
  await Bun.write(path.join(root, "provenance.json"), JSON.stringify({ workload: "typo" }))
  const diagnostic = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(diagnostic.exitCode).not.toBe(0)
  expect(diagnostic.stderr.toString()).toContain("typo workload is diagnostic")
  await Bun.write(path.join(root, "provenance.json"), JSON.stringify({ shortLivedThreads: true }))
  const shortLived = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(shortLived.exitCode).not.toBe(0)
  expect(shortLived.stderr.toString()).toContain("CPU time accounting is unreliable")
  await Bun.write(path.join(root, "provenance.json"), JSON.stringify({ cpuAccountingUncertain: true }))
  const uncertain = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(uncertain.exitCode).not.toBe(0)
  expect(uncertain.stderr.toString()).toContain("CPU time accounting is unreliable")
  await Bun.write(path.join(root, "provenance.json"), "{}")
  await Bun.write(path.join(root, "cpu-accounting-invalid.json"), "{}")
  const invalidated = Bun.spawnSync([...args, "--baseline", "fff"], { stdout: "pipe", stderr: "pipe" })
  expect(invalidated.exitCode).not.toBe(0)
  expect(invalidated.stderr.toString()).toContain("CPU time accounting is unreliable")
})

test("rejects Windows promotion until bursty CPU accounting is validated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "redcode-windows-cpu-gate-"))
  await Bun.write(path.join(root, "provenance.json"), JSON.stringify({ platform: "win32" }))
  const result = Bun.spawnSync([process.execPath, summarizer, "--input", root, "--out", path.join(root, "summary.json")], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("Windows CPU time accounting is not validated")
})
