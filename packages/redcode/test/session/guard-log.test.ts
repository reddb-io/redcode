import { describe, expect, test } from "bun:test"
import { summarize } from "@/session/guard-log"

describe("guard log", () => {
  test("counts each guard and action separately", () => {
    // A guard that warns ten times and stops once is a very different picture from one that
    // stops ten times, and the whole point of the log is to tell those apart.
    const rows = summarize([
      { guard: "stall", action: "warn" },
      { guard: "stall", action: "warn" },
      { guard: "stall", action: "stop" },
      { guard: "loop", action: "correct" },
    ])
    expect(rows).toEqual([
      { guard: "stall", action: "warn", count: 2 },
      { guard: "loop", action: "correct", count: 1 },
      { guard: "stall", action: "stop", count: 1 },
    ])
  })

  test("puts the loudest first", () => {
    // What fires most is what most needs its threshold questioned, so it reads first.
    const rows = summarize([
      { guard: "loop", action: "correct" },
      { guard: "tool_timeout", action: "stop" },
      { guard: "tool_timeout", action: "stop" },
    ])
    expect(rows[0]).toEqual({ guard: "tool_timeout", action: "stop", count: 2 })
  })

  test("says nothing rather than something when nothing fired", () => {
    expect(summarize([])).toEqual([])
  })
})
