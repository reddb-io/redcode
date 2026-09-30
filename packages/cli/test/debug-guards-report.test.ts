import { describe, expect, test } from "bun:test"
import { SessionGuard } from "@opencode/schema/session-guard"
import { SessionID } from "@opencode/schema/session-id"
import { stopLossLines, stopLossReport } from "../src/commands/handlers/debug/stop-loss-report"

const entry = (guard: SessionGuard.Guard, action: SessionGuard.Action, subject?: string): SessionGuard.Entry => ({
  id: crypto.randomUUID(),
  sessionID: SessionID.make("ses_guards"),
  guard,
  action,
  ...(subject ? { subject } : {}),
  detail: "detail",
  at: 0,
})

describe("stop-loss report", () => {
  const entries = [
    entry("stop_loss", "correct", "no_progress"),
    entry("stop_loss", "correct", "same_result"),
    entry("stop_loss", "stop", "same_result"),
    entry("stop_loss", "warn", `${SessionGuard.STOP_LOSS_DISMISSED}no_progress`),
    entry("stop_loss", "warn", `${SessionGuard.STOP_LOSS_PROGRESSED}`),
    entry("loop", "stop", "bash"),
    entry("budget", "warn"),
  ]

  test("counts hints, stops, signals S1 let through and hints followed by progress", () => {
    expect(stopLossReport(entries)).toEqual({ hints: 2, stops: 1, dismissed: 1, progressed: 1 })
  })

  test("prints each as a share of what it belongs to", () => {
    expect(stopLossLines(stopLossReport(entries))).toEqual([
      "Stop-loss:",
      "  signals checked     4",
      "  let through by S1   1 (25%)",
      "  hints given         2",
      "  hints then progress 1 (50%)",
      "  turns stopped       1",
    ])
  })

  test("prints nothing when the stop-loss did not act", () => {
    expect(stopLossReport([entry("loop", "stop")])).toEqual({ hints: 0, stops: 0, dismissed: 0, progressed: 0 })
    expect(stopLossLines(stopLossReport([entry("loop", "stop")]))).toEqual([])
    expect(stopLossLines(stopLossReport([]))).toEqual([])
  })

  test("leaves the shares blank without hints", () => {
    const lines = stopLossLines(stopLossReport([entry("stop_loss", "stop", "same_result")]))
    expect(lines).toContain("  hints then progress 0")
  })
})
