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

const SHARED = ["REDCODE_VERBOSE", "REDCODE_BOOT_START", "REDCODE_VERBOSE_BOOT_FILE", "REDCODE_VERBOSE_NO_STDERR"]

describe("BootTrace", () => {
  let dir: string
  let out: Written
  let restore: () => void

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-boot-trace-"))
    for (const key of SHARED) delete process.env[key]
    process.env.REDCODE_VERBOSE_BOOT_FILE = path.join(dir, "boot.log")
    BootTrace.reset()
    out = { stderr: [] }
    restore = captureStderr(out)
  })

  afterEach(() => {
    restore()
    for (const key of SHARED) delete process.env[key]
    BootTrace.reset()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("records every phase with elapsed and delta even when tracing is off", () => {
    process.env.REDCODE_BOOT_START = String(Date.now() - 100)
    BootTrace.reset()
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
    BootTrace.mark("process.start")
    // The flag is parsed after the first mark: enabling catches up on it.
    BootTrace.enable()
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
    BootTrace.enable()
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
    // Marks after the end of boot are written but no longer retained: a server runs for days.
    expect(BootTrace.phases().map((mark) => mark.phase)).toEqual(["session.ready", "tui.mounted", "tui.first-render"])
  })

  test("never prints a credential, whatever key or shape it arrives under", () => {
    BootTrace.enable()
    BootTrace.mark("providers.ready", {
      apiKey: "sk-live-1234567890",
      authorization: "Basic abc",
      header: "Bearer eyJhbGciOi",
      access_token: "ya29.a0AfH6",
      passphrase: "hunter2",
      aws: "AKIAIOSFODNN7EXAMPLE",
      google: "AIzaSyD-example",
      pat: "github_pat_11ABC",
      url: "https://user:secret@example.com/path?x=1",
      id: "anthropic",
      count: 3,
      estimatedTokens: 1200,
    })
    const line = out.stderr.join("")
    for (const secret of [
      "sk-live",
      "Basic abc",
      "eyJhbGci",
      "ya29",
      "hunter2",
      "AKIAIOSF",
      "AIzaSy",
      "github_pat_",
      "user:secret",
    ])
      expect(line).not.toContain(secret)
    expect(line).toContain("apiKey=[redacted]")
    expect(line).toContain("authorization=[redacted]")
    expect(line).toContain("header=[redacted]")
    expect(line).toContain("access_token=[redacted]")
    expect(line).toContain("passphrase=[redacted]")
    expect(line).toContain('url="https://[redacted]@example.com/path?x=1"')
    // A count of tokens is not a token.
    expect(line).toContain("id=anthropic count=3 estimatedTokens=1200")
  })

  test("reads the sharing variables once at start and removes them from the environment", () => {
    process.env.REDCODE_VERBOSE = "1"
    process.env.REDCODE_BOOT_START = "1700000000000"
    process.env.REDCODE_VERBOSE_BOOT_FILE = path.join(dir, "shared.log")
    process.env.REDCODE_VERBOSE_NO_STDERR = "1"
    BootTrace.reset()

    expect(BootTrace.enabled()).toBe(true)
    expect(BootTrace.start()).toBe(1700000000000)
    expect(BootTrace.filePath()).toBe(path.join(dir, "shared.log"))
    expect(BootTrace.mirror()).toBe(false)
    // A child this process spawns — a nested redcode, an MCP server — must see none of it.
    for (const key of SHARED) expect(process.env[key]).toBeUndefined()
  })

  test("hands a worker what it needs without touching the environment", () => {
    delete process.env.REDCODE_VERBOSE_BOOT_FILE
    BootTrace.reset()
    expect(BootTrace.workerEnv()).toEqual({})

    BootTrace.enable()
    BootTrace.setMirror(false)
    const env = BootTrace.workerEnv()
    expect(env.REDCODE_VERBOSE).toBe("1")
    expect(env.REDCODE_BOOT_START).toBe(String(BootTrace.start()))
    expect(env.REDCODE_VERBOSE_BOOT_FILE).toBe(BootTrace.filePath())
    expect(env.REDCODE_VERBOSE_NO_STDERR).toBe("1")
    expect(path.basename(env.REDCODE_VERBOSE_BOOT_FILE!)).toMatch(/^boot-\d{8}T\d{6}Z-\d+\.log$/)
    for (const key of SHARED) expect(process.env[key]).toBeUndefined()
  })
})
