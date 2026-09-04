import { describe as group, expect, test } from "bun:test"
import { decide, describe, warning, STALL_ABORT_MS_DEFAULT, STALL_WARN_MS_DEFAULT } from "@/session/stall"

const limits = { warnMs: STALL_WARN_MS_DEFAULT, abortMs: STALL_ABORT_MS_DEFAULT }
const quiet = (ms: number, over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ quietMs: ms, activeToolCount: 0, permissionPending: false, limits, ...over })

group("stall.decide", () => {
  test("a turn that is still producing is working", () => {
    expect(quiet(0).type).toBe("working")
    expect(quiet(STALL_WARN_MS_DEFAULT - 1).type).toBe("working")
  })

  test("warns once it has been quiet, and ends it once it has been quiet far longer", () => {
    expect(quiet(STALL_WARN_MS_DEFAULT)).toMatchObject({ type: "warn" })
    expect(quiet(STALL_ABORT_MS_DEFAULT)).toMatchObject({ type: "abort" })
  })

  test("a running tool is work, however long it is silent", () => {
    // The case that matters: tools run inside the provider SDK and emit nothing while they work,
    // so a half-hour build must never be mistaken for a hang.
    expect(quiet(STALL_ABORT_MS_DEFAULT * 10, { activeToolCount: 1 }).type).toBe("working")
  })

  test("a person deciding on a permission is not a stalled turn", () => {
    expect(quiet(STALL_ABORT_MS_DEFAULT * 10, { permissionPending: true }).type).toBe("working")
  })

  test("infinite limits disable each stage independently", () => {
    expect(quiet(10_000_000, { limits: { warnMs: Infinity, abortMs: Infinity } }).type).toBe("working")
    expect(quiet(10_000_000, { limits: { warnMs: 1, abortMs: Infinity } }).type).toBe("warn")
  })

  test("the abort reason says how long it was silent", () => {
    const decision = quiet(600_000)
    expect(decision.type).toBe("abort")
    if (decision.type === "abort") expect(decision.reason).toBe("no output for 10m")
  })
})

group("stall.describe", () => {
  test("reads the way someone would say it", () => {
    expect(describe(9_000)).toBe("9s")
    expect(describe(600_000)).toBe("10m")
    expect(describe(3_600_000)).toBe("1h")
    expect(describe(5_400_000)).toBe("1h 30m")
  })
})

group("stall.warning", () => {
  test("leaves room for the turn to recover instead of announcing an abort", () => {
    const text = warning(300_000, limits)
    expect(text).toBe("No output for 5m, ending it at 10m unless it resumes")
    expect(text).not.toContain("aborted")
  })

  test("says nothing about ending when ending is disabled", () => {
    expect(warning(300_000, { warnMs: 1, abortMs: Infinity })).toBe("No output for 5m")
  })
})
