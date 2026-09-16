import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { BootTrace } from "../../src/observability/boot-trace"

type Written = { stderr: string[] }

function captureStderr(into: Written) {
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    into.stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  return () => {
    process.stderr.write = original
  }
}

describe("BootTrace", () => {
  const saved = {
    verbose: process.env.REDCODE_VERBOSE,
    start: process.env.REDCODE_BOOT_START,
    file: process.env.REDCODE_VERBOSE_BOOT_FILE,
  }
  let dir: string
  let out: Written
  let restore: () => void

  beforeEach(() => {
    BootTrace.reset()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-boot-trace-"))
    delete process.env.REDCODE_BOOT_START
    process.env.REDCODE_VERBOSE_BOOT_FILE = path.join(dir, "boot.log")
    out = { stderr: [] }
    restore = captureStderr(out)
  })

  afterEach(() => {
    restore()
    BootTrace.reset()
    fs.rmSync(dir, { recursive: true, force: true })
    for (const [key, value] of [
      ["REDCODE_VERBOSE", saved.verbose],
      ["REDCODE_BOOT_START", saved.start],
      ["REDCODE_VERBOSE_BOOT_FILE", saved.file],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("records every phase with elapsed and delta even when tracing is off", () => {
    delete process.env.REDCODE_VERBOSE
    process.env.REDCODE_BOOT_START = String(Date.now() - 100)
    BootTrace.mark("process.start")
    BootTrace.mark("cli.parsed", { version: "1.2.3" })
    const phases = BootTrace.phases()
    expect(phases.map((mark) => mark.phase)).toEqual(["process.start", "cli.parsed"])
    expect(phases[0]!.since).toBeGreaterThanOrEqual(100)
    expect(phases[1]!.since).toBeGreaterThanOrEqual(phases[0]!.since)
    expect(phases[1]!.delta).toBeLessThanOrEqual(phases[1]!.since)
    expect(phases[1]!.facts).toEqual({ version: "1.2.3" })
    // Off means nothing is written anywhere.
    expect(out.stderr).toEqual([])
    expect(fs.existsSync(path.join(dir, "boot.log"))).toBe(false)
  })

  test("writes one line per phase to stderr and the file, then a summary on stop", () => {
    process.env.REDCODE_VERBOSE = "1"
    BootTrace.mark("process.start")
    BootTrace.mark("config.loaded", { plugins: 2, path: "/home/someone/.red/code/redcode.json" })
    const summary = BootTrace.stop("tui.first-render")

    const lines = out.stderr.join("").trimEnd().split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^boot\s+\d+ms\s+\+\d+ms process\.start$/)
    expect(lines[1]).toMatch(/^boot\s+\d+ms\s+\+\d+ms config\.loaded plugins=2 path=/)
    expect(lines[2]).toMatch(/tui\.first-render$/)
    expect(lines[3]).toBe(summary)
    expect(summary).toMatch(/^boot complete in \d+ ms; log at .*boot\.log$/)
    expect(fs.readFileSync(path.join(dir, "boot.log"), "utf8").trimEnd().split("\n")).toEqual(lines)
  })

  test("stops writing to stderr once the screen takes over, keeps the file, and stops once", () => {
    process.env.REDCODE_VERBOSE = "1"
    BootTrace.mark("session.ready")
    BootTrace.quiet()
    BootTrace.mark("tui.mounted")
    const first = BootTrace.stop("tui.first-render")
    BootTrace.mark("later.phase")
    const second = BootTrace.stop("again")

    const stderr = out.stderr.join("")
    expect(stderr).toContain("session.ready")
    expect(stderr).toContain("screen takeover; the trace continues in")
    expect(stderr).not.toContain("tui.mounted")
    expect(stderr).not.toContain("boot complete")
    const file = fs.readFileSync(path.join(dir, "boot.log"), "utf8")
    expect(file).toContain("tui.mounted")
    expect(file).toContain("tui.first-render")
    expect(file).toContain("later.phase")
    expect(file.match(/boot complete/g)).toHaveLength(1)
    // The summary is the moment of the first render, not whatever came after.
    expect(second).toBe(first)
    expect(BootTrace.phases().map((mark) => mark.phase)).toEqual([
      "session.ready",
      "tui.mounted",
      "tui.first-render",
      "later.phase",
    ])
  })

  test("never prints a credential, whatever key or shape it arrives under", () => {
    process.env.REDCODE_VERBOSE = "1"
    BootTrace.mark("providers.ready", {
      apiKey: "sk-live-1234567890",
      authorization: "Basic abc",
      header: "Bearer eyJhbGciOi",
      access_token: "ya29.a0AfH6",
      id: "anthropic",
      count: 3,
      estimatedTokens: 1200,
    })
    const line = out.stderr.join("")
    expect(line).not.toContain("sk-live")
    expect(line).not.toContain("Basic abc")
    expect(line).not.toContain("eyJhbGci")
    expect(line).not.toContain("ya29")
    expect(line).toContain("apiKey=[redacted]")
    expect(line).toContain("authorization=[redacted]")
    expect(line).toContain("header=[redacted]")
    expect(line).toContain("access_token=[redacted]")
    // A count of tokens is not a token.
    expect(line).toContain("id=anthropic count=3 estimatedTokens=1200")
  })

  test("shares the process start and the file with a worker through the environment", () => {
    process.env.REDCODE_VERBOSE = "1"
    delete process.env.REDCODE_VERBOSE_BOOT_FILE
    const start = BootTrace.start()
    expect(process.env.REDCODE_BOOT_START ?? "").toBe(String(start))
    expect(BootTrace.start()).toBe(start)
    const file = BootTrace.filePath()
    expect(process.env.REDCODE_VERBOSE_BOOT_FILE ?? "").toBe(file)
    expect(path.basename(file)).toMatch(/^boot-\d{8}T\d{6}Z-\d+\.log$/)
  })
})
