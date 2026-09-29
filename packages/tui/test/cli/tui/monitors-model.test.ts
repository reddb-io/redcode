import { describe, expect, test } from "bun:test"
import type { MonitorPublicInfo } from "@opencode/client"
import {
  SUMMARY_CHARS,
  finishToast,
  finishedMonitors,
  monitorDelivery,
  monitorDetail,
  monitorState,
  monitorSummary,
  monitorTarget,
  monitorsIndicator,
  sortMonitors,
  timeLeft,
} from "../../../src/routes/session/composer/monitors-model"

function monitor(input: Partial<MonitorPublicInfo> & Pick<MonitorPublicInfo, "id">): MonitorPublicInfo {
  return {
    sessionID: "ses_fixture",
    command: "gh run view 42 --json status",
    workdir: "/repo",
    options: { mode: "poll", interval_ms: 10_000, deadline_ms: 600_000 },
    status: "running",
    created: 1_000,
    updated: 1_000,
    attempts: 1,
    delivery: "pending",
    ...input,
  }
}

describe("monitor rows", () => {
  test("maps every status to a label and a semantic tone", () => {
    expect(monitorState("running")).toEqual({ label: "running", tone: "info" })
    expect(monitorState("succeeded")).toEqual({ label: "succeeded", tone: "success" })
    expect(monitorState("failed")).toEqual({ label: "failed", tone: "error" })
    expect(monitorState("timed_out")).toEqual({ label: "timed out", tone: "warning" })
    expect(monitorState("cancelled")).toEqual({ label: "cancelled", tone: "muted" })
    expect(monitorState("interrupted").tone).toBe("warning")
    expect(monitorState("expired").tone).toBe("muted")
    expect(monitorDelivery("delivered")).toBe("delivered")
    expect(monitorDelivery("observed")).toBe("returned inline")
    expect(monitorDelivery("suppressed")).toBe("not delivered")
  })

  test("sorts running monitors first, newest first, then settled ones by last update", () => {
    const sorted = sortMonitors([
      monitor({ id: "old-done", status: "succeeded", created: 1, updated: 10 }),
      monitor({ id: "old-running", created: 2 }),
      monitor({ id: "new-done", status: "failed", created: 3, updated: 30 }),
      monitor({ id: "new-running", created: 4 }),
    ])
    expect(sorted.map((info) => info.id)).toEqual(["new-running", "old-running", "new-done", "old-done"])
  })

  test("counts down to the deadline only while running", () => {
    const info = monitor({ id: "m", created: 0, options: { mode: "poll", deadline_ms: 3_725_000 } })
    expect(timeLeft(info, 0)).toBe("1h 2m left")
    expect(timeLeft(info, 3_725_000 - 90_000)).toBe("1m 30s left")
    expect(timeLeft(info, 3_725_000 - 4_200)).toBe("5s left")
    expect(timeLeft(info, 3_725_000)).toBe("deadline passed")
    expect(timeLeft({ ...info, status: "succeeded" }, 0)).toBeUndefined()
    // Without a deadline the runtime default of one hour applies.
    expect(timeLeft(monitor({ id: "d", created: 0, options: { mode: "once" } }), 0)).toBe("1h 0m left")
  })

  test("shows the target on one printable line", () => {
    expect(monitorTarget(monitor({ id: "m", command: "probe: GET https://example.com/health" }))).toBe(
      "probe: GET https://example.com/health",
    )
    expect(monitorTarget(monitor({ id: "m", command: "\u001b[31mwhile true;\n  do check; done" }))).toBe("while true;")
  })

  test("summarizes the last result as one bounded line", () => {
    expect(monitorSummary(monitor({ id: "m" }))).toBe("1 check · no result yet")
    expect(
      monitorSummary(
        monitor({
          id: "m",
          attempts: 3,
          evidence: { exit: 0, output: "queued\n\nin_progress\n", truncated: false },
        }),
      ),
    ).toBe("3 checks · in_progress")
    expect(
      monitorSummary(
        monitor({
          id: "m",
          attempts: 2,
          evidence: { exit: 0, output: "done", truncated: false, matched: 'exit code 0, output contains "done"' },
        }),
      ),
    ).toBe('2 checks · exit code 0, output contains "done"')
    expect(monitorSummary(monitor({ id: "m", error: "Cause:\n  boom" }))).toBe("1 check · Cause:")
    const long = monitorSummary(monitor({ id: "m", evidence: { exit: 1, output: "x".repeat(500), truncated: true } }))
    expect(long).toHaveLength(SUMMARY_CHARS)
    expect(long.endsWith("…")).toBe(true)
  })

  test("details carry the same evidence the former dialog showed", () => {
    const detail = monitorDetail(
      monitor({
        id: "m",
        attempts: 4,
        error: "timed out",
        evidence: {
          exit: 1,
          output: "line one\nline two",
          truncated: true,
          matched: "failure_contains",
          outputPath: "/tmp/out.log",
        },
      }),
    )
    expect(detail).toContain("4 checks · every 10s")
    expect(detail).toContain("timed out")
    expect(detail).toContain("Matched: failure_contains")
    expect(detail).toContain("line one\nline two")
    expect(detail).toContain("Full output: /tmp/out.log")
    expect(monitorDetail(monitor({ id: "m", options: { mode: "once" } }))).toContain("No result yet.")
    expect(monitorDetail(monitor({ id: "m", options: { mode: "once" } }))).toContain("1 check · /repo")
  })
})

describe("monitor transitions", () => {
  test("the footer indicator exists only while something runs", () => {
    expect(monitorsIndicator([])).toBeUndefined()
    expect(monitorsIndicator([monitor({ id: "a", status: "succeeded" })])).toBeUndefined()
    expect(monitorsIndicator([monitor({ id: "a" })])).toBe("1 monitor")
    expect(monitorsIndicator([monitor({ id: "a" }), monitor({ id: "b" })])).toBe("2 monitors")
  })

  test("finds monitors that settled between two reads", () => {
    const previous = [monitor({ id: "a" }), monitor({ id: "b" }), monitor({ id: "c", status: "failed" })]
    const next = [
      monitor({ id: "a", status: "succeeded" }),
      monitor({ id: "b" }),
      monitor({ id: "c", status: "failed" }),
      monitor({ id: "d", status: "succeeded" }),
    ]
    expect(finishedMonitors(previous, next).map((info) => info.id)).toEqual(["a"])
    expect(finishedMonitors([], next)).toEqual([])
  })

  test("finish toasts use the outcome's feedback variant", () => {
    expect(finishToast(monitor({ id: "a", status: "succeeded", command: "build" }))).toEqual({
      variant: "success",
      message: "Monitor succeeded: build",
    })
    expect(finishToast(monitor({ id: "a", status: "failed" })).variant).toBe("error")
    expect(finishToast(monitor({ id: "a", status: "timed_out" })).variant).toBe("warning")
    expect(finishToast(monitor({ id: "a", status: "cancelled" })).variant).toBe("info")
    expect(finishToast(monitor({ id: "a", status: "failed", command: "y".repeat(100) })).message).toHaveLength(
      "Monitor failed: ".length + 60,
    )
  })
})
