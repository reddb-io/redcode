import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { check, report } from "../../script/binary-size"

const script = path.join(import.meta.dir, "../../script/binary-size.ts")

describe("binary size check", () => {
  test("passes at or under the baseline plus its allowance and fails above it", () => {
    const baseline = { bytes: 1000, allowance: 100 }
    expect(check(900, baseline)).toEqual({ ok: true, delta: -100, limit: 1100 })
    expect(check(1100, baseline)).toEqual({ ok: true, delta: 100, limit: 1100 })
    expect(check(1101, baseline)).toEqual({ ok: false, delta: 101, limit: 1100 })
  })

  test("fails without a recorded baseline", () => {
    expect(check(1000, undefined).ok).toBe(false)
    expect(report("linux-x64", 1000, undefined)).toEqual({
      ok: false,
      text: expect.stringContaining("no baseline is recorded for linux-x64"),
    })
  })

  test("reports the change and how to record a deliberate growth", () => {
    expect(report("linux-x64", 3 * 1024 * 1024, { bytes: 2 * 1024 * 1024, allowance: 0 }).text).toContain(
      "change +1.00 MiB",
    )
    expect(report("linux-x64", 3 * 1024 * 1024, { bytes: 2 * 1024 * 1024, allowance: 0 }).text).toContain("--update")
  })

  test("the command exits non-zero when the binary grew past the baseline and records a new one", async () => {
    await using tmp = await tmpdir()
    const binary = path.join(tmp.path, "redcode")
    const baseline = path.join(tmp.path, "binary-size.json")
    await Bun.write(binary, new Uint8Array(4096))
    await Bun.write(baseline, JSON.stringify({ "linux-x64": { bytes: 1024, allowance: 1024 } }))
    const run = (...args: string[]) =>
      Bun.spawn([process.execPath, script, binary, "--baseline", baseline, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      })
    const grown = run()
    expect(await grown.exited).toBe(1)
    expect(await new Response(grown.stdout).text()).toContain("grew past its baseline")
    expect(await run("--update").exited).toBe(0)
    expect(await Bun.file(baseline).json()).toEqual({ "linux-x64": { bytes: 4096, allowance: 1024 } })
    expect(await run().exited).toBe(0)
  })
})
