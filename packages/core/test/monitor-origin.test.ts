import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { MonitorRuntime } from "@opencode/core/monitor"
import { SessionMessage } from "@opencode/core/session/message"
import { Monitor } from "@opencode/schema/monitor"
import { SessionID } from "@opencode/schema/session-id"

const started = 10_000
const info: Monitor.Info = {
  id: "monitor_origin",
  sessionID: SessionID.make("ses_monitor_origin"),
  command: "gh run view 42",
  workdir: "/repo",
  options: { mode: "poll" },
  status: "succeeded",
  created: started,
  updated: started + 5_000,
  attempts: 3,
  delivery: "pending",
  evidence: { exit: 0, output: "completed", truncated: false, matched: "exit code 0" },
}
const at = (ms: number) => ({ created: DateTime.makeUnsafe(ms) })
const user = (value: string, ms: number) =>
  SessionMessage.User.make({ id: SessionMessage.ID.make(`msg_${value}`), type: "user", text: value, time: at(ms) })
const idle = (value: string, ms: number, outcome: SessionMessage.Idle["outcome"]) =>
  SessionMessage.Idle.make({ id: SessionMessage.ID.make(`msg_${value}`), type: "idle", outcome, time: at(ms) })

describe("MonitorRuntime.origin", () => {
  test("wakes a Session whose originating turn ended normally and that nobody wrote to since", () => {
    expect(
      MonitorRuntime.origin({
        info,
        messages: [user("request", started - 1_000), idle("done", started + 1_000, "succeeded")],
        goal: "waiting",
      }),
    ).toEqual({ notes: [], wake: true })
  })

  test("holds the wake back and names why when the turn was interrupted, the goal paused or the person wrote", () => {
    const decided = MonitorRuntime.origin({
      info,
      messages: [
        user("request", started - 1_000),
        idle("stopped", started + 1_000, "interrupted"),
        user("newer", started + 2_000),
      ],
      goal: "paused",
    })
    expect(decided.wake).toBeFalse()
    expect(decided.notes).toEqual([
      "The turn that started this monitor was interrupted; do not resume that work on this result alone.",
      "The session goal is paused; it waits for the person, not for this result.",
      "The person sent 1 newer instruction(s) since this monitor started; read the latest before acting on this result.",
    ])
  })

  test("ignores what happened before the monitor started", () => {
    expect(MonitorRuntime.origin({ info, messages: [idle("earlier", started - 500, "interrupted")] }).wake).toBeTrue()
  })
})

describe("MonitorRuntime.resultText", () => {
  test("leads with the result, then the origin notes, the matched condition and the rendered monitor", () => {
    const lines = MonitorRuntime.resultText(info, ["The session goal is blocked."]).split("\n")
    expect(lines[0]).toStartWith("A monitor finished.")
    expect(lines[1]).toBe("Origin: The session goal is blocked.")
    expect(lines[2]).toBe("Matched: exit code 0")
    expect(lines[3]).toContain('"monitor_result"')
  })

  test("says a monitor that ended without a result leaves the watched state unknown", () => {
    expect(MonitorRuntime.resultText({ ...info, status: "expired" }, [])).toStartWith(
      "A monitor ended without a result.",
    )
  })
})
