import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { statSync } from "node:fs"
import { MonitorProbe } from "../src/monitor-probe"
import { SafeRegex } from "../src/safe-regex"
import { probe as processRunner } from "../src/monitor"

const decodeOptions = Schema.decodeUnknownSync(Monitor.Options)
const decodeProbe = Schema.decodeUnknownSync(Monitor.Probe)

describe("monitor schema", () => {
  test("teaches the final-state condition and the interval budget", () => {
    expect(Monitor.probeInstructions).toContain("the final state that matters")
    expect(Monitor.probeInstructions).toContain("deadline_ms / interval_ms is the number of checks")
  })

  test("accepts valid probes and conditions", () => {
    expect(
      decodeProbe({ type: "http", url: "http://localhost:1/health", json_path: "$.data[0].state", equals: "ok" }),
    ).toBeDefined()
    expect(decodeProbe({ type: "file", path: "dist/a.js", state: "changed", min_size: 1 })).toBeDefined()
    expect(decodeProbe({ type: "process", name: "vite", state: "exited" })).toBeDefined()
    expect(
      decodeOptions({
        mode: "poll",
        success_regex: "^deployed\\b",
        failure_regex: "error|fail",
        until: "changed",
        jitter: false,
      }),
    ).toBeDefined()
  })

  test("refuses a bad regex, an overlong regex and a bad json_path at input time", () => {
    expect(() => decodeOptions({ mode: "poll", success_regex: "(unclosed" })).toThrow(/regular expression/i)
    expect(() => decodeOptions({ mode: "poll", failure_regex: "a".repeat(Monitor.REGEX_MAX_LENGTH + 1) })).toThrow(
      /at most/,
    )
    expect(() => decodeProbe({ type: "http", url: "http://x", regex: "[" })).toThrow(/regular expression/i)
    for (const json_path of ["$..deep", "$.a[", "a b", "$[x]"])
      expect(() => decodeProbe({ type: "http", url: "http://x", json_path })).toThrow(/JSON path/)
    expect(Monitor.jsonPath('$.a["b-c"][2].d')).toEqual(["a", "b-c", 2, "d"])
    expect(Monitor.jsonPath("status.ready")).toEqual(["status", "ready"])
  })

  test("reports rules that span fields", () => {
    expect(Monitor.probeProblem({ type: "http", url: "ftp://x" })).toContain("http://")
    expect(Monitor.probeProblem({ type: "http", url: "http://x", method: "HEAD", contains: "a" })).toContain("HEAD")
    expect(Monitor.probeProblem({ type: "process", state: "running" })).toContain("exactly one")
    expect(Monitor.probeProblem({ type: "process", name: "a", pid: 1, state: "running" })).toContain("exactly one")
    expect(Monitor.probeProblem({ type: "file", path: "a", state: "missing", min_size: 1 })).toContain("min_size")
    expect(Monitor.probeProblem({ type: "http", url: "http://x", expect_status: [200, 700] })).toContain("between")
  })

  test("accepts only plain variable names in {env:...}, so a permission pattern can never be a wildcard", () => {
    const withHeader = (value: string) =>
      Monitor.probeProblem({ type: "http", url: "https://api.example.com", headers: { Authorization: value } })
    expect(withHeader("Bearer {env:GITHUB_TOKEN}")).toBeUndefined()
    expect(withHeader("{env:_A1} {env:B}")).toBeUndefined()
    for (const value of ["{env:*}", "{env:GITHUB_*}", "{env:A?}", "{env:1ABC}", "{env:A-B}", "{env:}", "{env:A B}"])
      expect({ value, problem: withHeader(value) }).toEqual({
        value,
        problem: expect.stringContaining("letters, digits"),
      })
    expect(withHeader("Bearer {env:TOKEN")).toContain("unclosed")
    expect(Monitor.probeProblem({ type: "http", url: "http://a*b.example.com/health" })).toContain("must not contain")
    expect(MonitorProbe.envPermissionPattern("GITHUB_TOKEN", "api.example.com")).toBe("GITHUB_TOKEN@api.example.com")
    expect(() => MonitorProbe.envPermissionPattern("*", "evil.example")).toThrow()
    expect(() => MonitorProbe.envPermissionPattern("TOKEN", "*.evil.example")).toThrow()
    // A reference that is not a plain name is never expanded or listed.
    expect(MonitorProbe.envNames({ A: "{env:*} {env:OK}" })).toEqual(["OK"])
    expect(MonitorProbe.headerValues({ A: "{env:*}" }, { "*": "secret" })).toEqual({ A: "{env:*}" })
  })

  test("never renders header values", () => {
    const info: Monitor.Info = {
      id: "monitor_1",
      sessionID: "ses_1",
      command: "probe: GET http://x",
      workdir: "/p",
      options: { mode: "poll" },
      probe: { type: "http", url: "http://x", headers: { Authorization: "Bearer secret-token" } },
      status: "running",
      created: 1,
      updated: 1,
      attempts: 0,
      delivery: "pending",
    }
    expect(Monitor.render(info)).not.toContain("secret-token")
    expect(Monitor.renderList([info])).not.toContain("secret-token")
    expect(Monitor.render(info)).toContain("Authorization")
  })
})

describe("command poll verdicts", () => {
  const evidence = (output: string, exit = 0): Monitor.Evidence => ({ exit, output, truncated: false })

  test("success and failure regexes decide on what the worker found, with contains unchanged", () => {
    const options: Monitor.Options = { mode: "poll", success_regex: "deployed v\\d+", failure_regex: "ERROR \\d+" }
    const none = { success: { match: undefined }, failure: { match: undefined } }
    const deployed = { ...none, success: { match: "deployed v12" } }
    expect(Monitor.verdict(options, evidence("pending"), undefined, none)).toBeUndefined()
    expect(Monitor.verdict(options, evidence("deployed v12"), undefined, deployed)).toEqual({
      status: "succeeded",
      matched: 'exit code 0, success_regex matched "deployed v12"',
    })
    expect(Monitor.verdict(options, evidence("deployed v12", 1), undefined, deployed)).toBeUndefined()
    expect(
      Monitor.verdict(options, evidence("ERROR 503", 1), undefined, { ...none, failure: { match: "ERROR 503" } })
        ?.status,
    ).toBe("failed")
    // A pattern that timed out, or was never run, is not a match.
    expect(
      Monitor.verdict(options, evidence("deployed v12"), undefined, { success: { timedOut: true } }),
    ).toBeUndefined()
    expect(Monitor.verdict(options, evidence("deployed v12"), undefined)).toBeUndefined()
    const contains: Monitor.Options = { mode: "poll", success_contains: "ready", failure_contains: "fail" }
    expect(Monitor.verdict(contains, evidence("ready"), undefined)?.status).toBe("succeeded")
    expect(Monitor.verdict(contains, evidence("ready but fail"), undefined)?.status).toBe("failed")
    expect(Monitor.verdict({ mode: "poll" }, evidence("anything"), undefined)?.matched).toBe("exit code 0")
  })

  test("until changed compares against the first output, ignoring trailing whitespace only", () => {
    const options: Monitor.Options = { mode: "poll", until: "changed" }
    const baseline = Monitor.normalizeOutput("state: queued  \n\n")
    expect(Monitor.verdict(options, evidence("state: queued"), undefined)).toBeUndefined()
    expect(Monitor.verdict(options, evidence("state: queued\t\n"), baseline)).toBeUndefined()
    expect(Monitor.verdict(options, evidence(" state: queued"), baseline)?.status).toBe("succeeded")
    expect(Monitor.verdict(options, evidence("state: running"), baseline)?.matched).toContain("output changed")
    // The notice naming a saved-output file differs per attempt and is not a change.
    expect(Monitor.normalizeOutput("...output truncated...\n\nFull output saved to: /tmp/a\n\nstate: queued")).toBe(
      "state: queued",
    )
  })
})

describe("poll jitter", () => {
  /** A deterministic random source. */
  const sequence = (values: number[]) => {
    let index = 0
    return () => values[index++ % values.length]!
  }

  test("spreads five monitors created at the same instant", () => {
    const options: Monitor.Options = { mode: "poll", interval_ms: 10_000 }
    const random = sequence([0.05, 0.3, 0.55, 0.8, 0.95])
    const starts = Array.from({ length: 5 }, () => Monitor.initialDelay(options, random))
    expect(new Set(starts).size).toBe(5)
    for (const start of starts) expect(start).toBeGreaterThanOrEqual(0)
    for (const start of starts) expect(start).toBeLessThan(Monitor.INITIAL_JITTER_MS)
    const next = Array.from({ length: 5 }, () => Monitor.nextDelay(options, 0, random)!)
    expect(new Set(next).size).toBe(5)
  })

  test("jitter off keeps exact intervals and no initial delay", () => {
    const options: Monitor.Options = { mode: "poll", interval_ms: 5_000, jitter: false }
    const random = sequence([0, 0.99])
    expect(Monitor.initialDelay(options, random)).toBe(0)
    for (const elapsed of [0, 5_000, 10_000]) expect(Monitor.nextDelay(options, elapsed, random)).toBe(5_000)
    expect(Monitor.schedule(options)).toBe("every 5s")
    // A one-shot command is never jittered.
    expect(Monitor.initialDelay({ mode: "once" }, random)).toBe(0)
  })

  test("keeps the offset within ±10%, 250 ms to 30 s, and never under the 1 s minimum", () => {
    expect(Monitor.jitterSpread(1_000)).toBe(250)
    expect(Monitor.jitterSpread(60_000)).toBe(6_000)
    expect(Monitor.jitterSpread(3_600_000)).toBe(30_000)
    for (const interval of [1_000, 2_000, 60_000, 3_600_000]) {
      const options: Monitor.Options = { mode: "poll", interval_ms: interval, deadline_ms: 86_400_000 }
      const spread = Monitor.jitterSpread(interval)
      for (const value of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const delay = Monitor.nextDelay(options, 0, () => value)!
        expect(delay).toBeGreaterThanOrEqual(Math.max(Monitor.MIN_INTERVAL_MS, interval - spread))
        expect(delay).toBeLessThanOrEqual(interval + spread)
      }
      expect(Monitor.initialDelay(options, () => 0.999999)).toBeLessThan(Math.min(interval, Monitor.INITIAL_JITTER_MS))
    }
    expect(Monitor.schedule({ mode: "poll", interval_ms: 60_000 })).toBe("every 1m ±6s")
    expect(Monitor.schedule({ mode: "poll", interval_ms: 2_000 })).toBe("every 2s ±250ms")
  })

  test("keeps the first attempt inside an inline wait, and starts a changed poll at once", () => {
    const high = () => 0.999
    expect(Monitor.initialDelay({ mode: "poll", interval_ms: 10_000 }, high)).toBeLessThan(250)
    expect(Monitor.initialDelay({ mode: "poll", interval_ms: 10_000, wait_ms: 400 }, high)).toBeLessThan(100)
    expect(Monitor.initialDelay({ mode: "poll", interval_ms: 10_000, wait_ms: 0 }, high)).toBeGreaterThan(1_900)
    expect(Monitor.initialDelay({ mode: "poll", wait_ms: 0, until: "changed" }, high)).toBe(0)
  })

  test("leaves the attempt's own timeout before the deadline", () => {
    const options: Monitor.Options = { mode: "poll", interval_ms: 2_000, deadline_ms: 20_000, jitter: false }
    expect(Monitor.nextDelay(options, 0, () => 0, 10_000)).toBe(2_000)
    expect(Monitor.nextDelay(options, 9_000, () => 0, 10_000)).toBe(1_000)
    expect(Monitor.nextDelay(options, 10_000, () => 0, 10_000)).toBeUndefined()
  })

  test("never schedules an attempt past the deadline, and still checks before it", () => {
    for (const jitter of [true, false]) {
      const options: Monitor.Options = { mode: "poll", interval_ms: 10_000, deadline_ms: 35_000, jitter }
      let elapsed = Monitor.initialDelay(options, () => 0.99)
      const attempts = [elapsed]
      while (true) {
        const delay = Monitor.nextDelay(options, elapsed, () => 0.99)
        if (delay === undefined) break
        elapsed += delay
        attempts.push(elapsed)
      }
      for (const at of attempts) expect(at).toBeLessThan(35_000)
      // The last check lands in the final interval instead of being skipped.
      expect(attempts.at(-1)!).toBeGreaterThan(25_000)
    }
  })
})

describe("http probe", () => {
  let server: ReturnType<typeof Bun.serve>
  let other: ReturnType<typeof Bun.serve>
  let status = 500
  let lastAuth: string | null = null
  const base = () => `http://127.0.0.1:${server.port}`

  beforeAll(() => {
    other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("elsewhere") })
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        const url = new URL(request.url)
        lastAuth = request.headers.get("authorization")
        if (url.pathname === "/health") return new Response("ok", { status })
        if (url.pathname === "/job") return Response.json({ data: { state: "done", items: [{ n: 3 }] } })
        if (url.pathname === "/same") return Response.redirect(`${base()}/health`, 302)
        if (url.pathname === "/redos") return new Response(`${"a".repeat(40)}!`)
        if (url.pathname === "/away") return Response.redirect(`http://localhost:${other.port}/secret?token=x`, 302)
        if (url.pathname === "/big") return new Response("x".repeat(MonitorProbe.HTTP_MAX_BYTES + 10) + "needle")
        if (url.pathname === "/slow") {
          await Bun.sleep(2_000)
          return new Response("late")
        }
        return new Response("missing", { status: 404 })
      },
    })
  })
  afterAll(() => {
    server.stop(true)
    other.stop(true)
  })

  test("counts 2xx as up by default and honours expect_status", async () => {
    status = 500
    expect((await MonitorProbe.http({ type: "http", url: `${base()}/health` })).probe).toEqual({
      matched: false,
      status: 500,
    })
    status = 200
    const up = await MonitorProbe.http({ type: "http", url: `${base()}/health` })
    expect(up.probe).toEqual({ matched: true, status: 200 })
    expect(up.output).toBe("HTTP 200 (expected 2xx)")
    expect(
      (await MonitorProbe.http({ type: "http", url: `${base()}/nope`, expect_status: [404, 410] })).probe.matched,
    ).toBe(true)
  })

  test("follows a redirect on the same host, and reports one to another host without following it", async () => {
    status = 200
    expect((await MonitorProbe.http({ type: "http", url: `${base()}/same` })).probe.matched).toBe(true)
    const away = await MonitorProbe.http({
      type: "http",
      url: `${base()}/away`,
      headers: { Authorization: "Bearer {env:PROBE_TOKEN}" },
    })
    expect(away.probe.matched).toBe(false)
    expect(away.probe.status).toBe(302)
    expect(away.probe.redirect).toContain("another host")
    expect(away.probe.redirect).not.toContain("token=")
  })

  test("does not follow a same-host redirect the webfetch rules do not cover", async () => {
    status = 200
    const result = await MonitorProbe.http({ type: "http", url: `${base()}/same` }, { allowRedirect: () => false })
    expect(result.probe).toMatchObject({
      matched: false,
      status: 302,
      redirect: expect.stringContaining("does not cover"),
    })
  })

  test("a catastrophic regex times out as an error instead of freezing the probe", async () => {
    const result = await MonitorProbe.http({ type: "http", url: `${base()}/redos`, regex: "^(a+)+$" })
    expect(result.probe).toMatchObject({
      matched: false,
      status: 200,
      error: expect.stringContaining(SafeRegex.TIMEOUT_ERROR),
    })
  })

  test("reads no environment variable it was not given", async () => {
    process.env.MONITOR_PROBE_UNGIVEN = "should-not-leak"
    try {
      status = 200
      await MonitorProbe.http({
        type: "http",
        url: `${base()}/health`,
        headers: { Authorization: "Bearer {env:MONITOR_PROBE_UNGIVEN}" },
      })
      expect(lastAuth ?? "").not.toContain("should-not-leak")
      expect(MonitorProbe.envNames({ A: "{env:ONE} {env:TWO}", B: "{env:ONE}" })).toEqual(["ONE", "TWO"])
    } finally {
      delete process.env.MONITOR_PROBE_UNGIVEN
    }
  })

  test("resolves {env:NAME} in header values without recording them", async () => {
    const result = await MonitorProbe.http(
      { type: "http", url: `${base()}/health`, headers: { Authorization: "Bearer {env:PROBE_TOKEN}" } },
      { env: { PROBE_TOKEN: "t0ken" } },
    )
    expect(lastAuth).toBe("Bearer t0ken")
    expect(JSON.stringify(result)).not.toContain("t0ken")
  })

  test("matches json_path with equals, contains and regex", async () => {
    const url = `${base()}/job`
    const equals = await MonitorProbe.http({ type: "http", url, json_path: "$.data.state", equals: "done" })
    expect(equals.probe).toEqual({ matched: true, status: 200, value: '"done"' })
    expect(equals.output).toContain('$.data.state = "done"')
    expect(
      (await MonitorProbe.http({ type: "http", url, json_path: "$.data.items[0].n", equals: "3" })).probe.matched,
    ).toBe(true)
    expect(
      (await MonitorProbe.http({ type: "http", url, json_path: "$.data.state", equals: "queued" })).probe.matched,
    ).toBe(false)
    expect((await MonitorProbe.http({ type: "http", url, json_path: "$.data.missing" })).probe.matched).toBe(false)
    expect((await MonitorProbe.http({ type: "http", url, contains: '"state":"done"' })).probe.matched).toBe(true)
    expect(
      (await MonitorProbe.http({ type: "http", url, json_path: "$.data", regex: 'state":"d.ne' })).probe.matched,
    ).toBe(true)
  })

  test("reads at most the size cap, so a match past it is not seen", async () => {
    const result = await MonitorProbe.http({ type: "http", url: `${base()}/big`, regex: "needle" })
    expect(result.probe).toMatchObject({ matched: false, truncated: true })
    const json = await MonitorProbe.http({ type: "http", url: `${base()}/big`, json_path: "$.a" })
    expect(json.probe.error).toContain("larger than")
  })

  test("gives up on a slow response after the per-attempt timeout", async () => {
    const started = Date.now()
    const result = await MonitorProbe.http({ type: "http", url: `${base()}/slow` }, { timeoutMs: 200 })
    expect(result.probe.matched).toBe(false)
    expect(result.probe.error).toContain("no response within 200 ms")
    expect(Date.now() - started).toBeLessThan(1_500)
  })
})

describe("file probe", () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "monitor-probe-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("exists, missing and min_size", async () => {
    const file = path.join(dir, "report.json")
    const exists: Monitor.FileProbe = { type: "file", path: "report.json", state: "exists", min_size: 2 }
    const missing: Monitor.FileProbe = { type: "file", path: "report.json", state: "missing" }
    let now = await MonitorProbe.observeFile(file)
    expect(MonitorProbe.fileResult(exists, now, undefined).probe).toEqual({ matched: false, exists: false })
    expect(MonitorProbe.fileResult(missing, now, undefined).probe.matched).toBe(true)
    await writeFile(file, "1")
    now = await MonitorProbe.observeFile(file)
    expect(MonitorProbe.fileResult(exists, now, undefined).probe.matched).toBe(false)
    await writeFile(file, "{}")
    now = await MonitorProbe.observeFile(file)
    expect(MonitorProbe.fileResult(exists, now, undefined).probe).toMatchObject({
      matched: true,
      exists: true,
      size: 2,
    })
    expect(MonitorProbe.fileResult(missing, now, undefined).probe.matched).toBe(false)
  })

  test("changed compares against the first observation, content included for small files", async () => {
    const file = path.join(dir, "out.txt")
    await writeFile(file, "aaaa")
    const probe: Monitor.FileProbe = { type: "file", path: "out.txt", state: "changed" }
    const hash = { hash: true }
    // Only a changed probe reads the content.
    expect((await MonitorProbe.observeFile(file)).hash).toBeUndefined()
    const first = await MonitorProbe.observeFile(file, hash)
    expect(first.hash).toBeDefined()
    expect(MonitorProbe.fileResult(probe, first, undefined).probe.matched).toBe(false)
    expect(MonitorProbe.fileResult(probe, await MonitorProbe.observeFile(file, hash), first).probe.matched).toBe(false)
    // Same size and the same mtime: only the hash tells.
    const { mtime } = await stat(file)
    await writeFile(file, "bbbb")
    await utimes(file, mtime, mtime)
    const rewritten = await MonitorProbe.observeFile(file, hash)
    expect(MonitorProbe.fileResult(probe, rewritten, first).probe.matched).toBe(true)
    await rm(file)
    expect(MonitorProbe.fileResult(probe, await MonitorProbe.observeFile(file, hash), first).probe.matched).toBe(true)
  })
})

describe("process probe", () => {
  test("running and exited by pid, with a spawned child", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
    try {
      await Bun.sleep(100)
      expect(MonitorProbe.processCheck({ type: "process", pid: child.pid!, state: "running" }).probe).toEqual({
        matched: true,
        pids: [child.pid!],
      })
      child.kill()
      await new Promise((resolve) => child.once("exit", resolve))
      let result = MonitorProbe.processCheck({ type: "process", pid: child.pid!, state: "exited" })
      for (let i = 0; i < 50 && !result.probe.matched; i++) {
        await Bun.sleep(20)
        result = MonitorProbe.processCheck({ type: "process", pid: child.pid!, state: "exited" })
      }
      expect(result.probe.matched).toBe(true)
    } finally {
      child.kill()
    }
  })

  // `tasklist` reports image names only, so a command-line marker cannot be seen there.
  test.skipIf(process.platform === "win32")("running and exited by a command-line name", async () => {
    const marker = `monitor-probe-marker-${crypto.randomUUID()}`
    const byCommandLine = { type: "process", name: marker, match: "cmdline" } as const
    expect(MonitorProbe.processCheck({ ...byCommandLine, state: "exited" }).probe.matched).toBe(true)
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", marker], { stdio: "ignore" })
    try {
      let running = MonitorProbe.processCheck({ ...byCommandLine, state: "running" })
      for (let i = 0; i < 50 && !running.probe.matched; i++) {
        await Bun.sleep(20)
        running = MonitorProbe.processCheck({ ...byCommandLine, state: "running" })
      }
      // By default a name is an executable name, which the marker is not.
      expect(MonitorProbe.processCheck({ type: "process", name: marker, state: "running" }).probe.matched).toBe(false)
      expect(running.probe).toEqual({ matched: true, pids: [child.pid!] })
    } finally {
      child.kill()
    }
  })

  test("matches the executable name exactly by default, a command line only when asked, and never this process", () => {
    const self = { pid: process.pid, name: "bun", command: "bun redcode" }
    expect(MonitorProbe.matchesName(self, "bun", "name", "linux")).toBe(false)
    expect(MonitorProbe.matchesName(self, "redcode", "cmdline", "linux")).toBe(false)
    const vite = { pid: 1234, name: "node", command: "/usr/bin/node /app/node_modules/.bin/vite build" }
    expect(MonitorProbe.matchesName(vite, "node", "name", "linux")).toBe(true)
    expect(MonitorProbe.matchesName(vite, "vite", "name", "linux")).toBe(false)
    expect(MonitorProbe.matchesName(vite, "no", "name", "linux")).toBe(false)
    expect(MonitorProbe.matchesName(vite, "vite build", "cmdline", "linux")).toBe(true)
    expect(MonitorProbe.matchesName(vite, "Vite", "cmdline", "linux")).toBe(false)
    // Linux cuts a process name to 15 characters; the executable in the command line still matches.
    const long = { pid: 99, name: "very-long-serve", command: "/opt/bin/very-long-server-name --port 1" }
    expect(MonitorProbe.matchesName(long, "very-long-server-name", "name", "linux")).toBe(true)
    expect(MonitorProbe.matchesName({ pid: 5, name: "Code", command: "Code.exe" }, "code.exe", "name", "win32")).toBe(
      true,
    )
    expect(
      MonitorProbe.processCheck({ type: "process", name: "vite", state: "exited" }, "linux", () => undefined).probe,
    ).toEqual({ matched: false, error: "could not list processes" })
  })

  test("a process that cannot be looked at is unknown, never exited", () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(MonitorProbe.pidState(999_999_999, "win32", fail("ESRCH"))).toBe("exited")
    expect(MonitorProbe.pidState(999_999_999, "win32", fail("EPERM"))).toBe("unknown")
    expect(MonitorProbe.pidState(999_999_999, "win32", fail("EINVAL"))).toBe("unknown")
    expect(MonitorProbe.pidState(999_999_999, "win32", () => {})).toBe("running")
    // A /proc entry hidden from this user reads as missing, while the signal check says the process exists.
    if (process.platform === "linux") expect(MonitorProbe.pidState(999_999_999, "linux", fail("EPERM"))).toBe("unknown")
    const unknown = MonitorProbe.processCheck(
      { type: "process", pid: 999_999_999, state: "exited" },
      "win32",
      undefined,
      fail("EPERM"),
    )
    expect(unknown.probe).toMatchObject({ matched: false, error: expect.stringContaining("could not tell") })
  })

  test.skipIf(process.platform !== "linux")("lists only this user's processes", () => {
    const uid = process.getuid!()
    const entries = MonitorProbe.listProcesses("linux")!
    expect(entries.some((entry) => entry.pid === process.pid)).toBe(true)
    for (const entry of entries.slice(0, 100)) {
      let owner: number | undefined
      try {
        owner = statSync(`/proc/${entry.pid}`).uid
      } catch {
        continue
      }
      expect(owner).toBe(uid)
    }
  })
})

describe("process listings that cannot be verified", () => {
  const tasklist = (stdout: string) => {
    const original = processRunner.spawn
    processRunner.spawn = (() => ({
      pid: 0,
      output: [],
      stdout,
      stderr: "",
      status: 0,
      signal: null,
    })) as unknown as typeof processRunner.spawn
    return () => {
      processRunner.spawn = original
    }
  }

  test("a filtered Windows listing without this process is no answer, so exited never succeeds on it", () => {
    // What tasklist prints when a USERNAME filter matches nothing, for example a domain\user mismatch.
    const restore = tasklist("INFO: No tasks are running which match the specified criteria.\r\n")
    try {
      expect(MonitorProbe.listProcesses("win32")).toBeUndefined()
      expect(MonitorProbe.processCheck({ type: "process", name: "vite", state: "exited" }, "win32").probe).toEqual({
        matched: false,
        error: "could not list processes",
      })
    } finally {
      restore()
    }
  })

  test("a Windows listing that shows this process is trusted", () => {
    const restore = tasklist(
      `"bun.exe","${process.pid}","Console","1","90,000 K"\r\n"node.exe","4242","Console","1","50,000 K"\r\n`,
    )
    try {
      expect(MonitorProbe.listProcesses("win32")?.map((entry) => entry.pid)).toEqual([process.pid, 4242])
      expect(MonitorProbe.processCheck({ type: "process", name: "node", state: "running" }, "win32").probe).toEqual({
        matched: true,
        pids: [4242],
      })
      expect(MonitorProbe.processCheck({ type: "process", name: "vite", state: "exited" }, "win32").probe.matched).toBe(
        true,
      )
    } finally {
      restore()
    }
  })
})

describe("regular expressions off the main thread", () => {
  test("one monitor's stuck pattern does not delay another monitor's matches", async () => {
    const stuck = SafeRegex.create()
    const other = SafeRegex.create()
    try {
      // Some engines give up on catastrophic backtracking after a while and report no match, so the stuck
      // match may end either way; what matters is that the other monitor is answered while it is still busy.
      const slow = stuck.exec("^(a+)+$", `${"a".repeat(64)}!`, 5_000)
      await Bun.sleep(50)
      const fast = other.exec("b+", "aabbb")
      expect(await Promise.race([slow.then(() => "stuck"), fast.then(() => "other")])).toBe("other")
      expect(await fast).toEqual({ match: "bbb" })
      const ended = await slow
      expect("timedOut" in ended || ("match" in ended && ended.match === undefined)).toBe(true)
    } finally {
      stuck.close()
      other.close()
    }
  })

  test("a catastrophic pattern times out while the event loop keeps running, and the next one still works", async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    const started = Date.now()
    const outcome = await SafeRegex.exec("^(a+)+$", `${"a".repeat(40)}!`, 150)
    const elapsed = Date.now() - started
    clearInterval(timer)
    expect(outcome).toEqual({ timedOut: true })
    expect(elapsed).toBeLessThan(5_000)
    // Windows timer granularity can clamp a 5ms interval hard; two ticks still prove the loop ran.
    expect(ticks).toBeGreaterThanOrEqual(2)
    expect(await SafeRegex.exec("b+", "aabbb")).toEqual({ match: "bbb" })
    expect(await SafeRegex.exec("x", "abc")).toEqual({ match: undefined })
  })
})
