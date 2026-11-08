import { describe, expect, test } from "bun:test"
import {
  createSessionHandoffState,
  HANDOFF_ECHO_TIMEOUT_MS,
  HANDOFF_SEND_TIMEOUT_MS,
  HANDOFF_SYNC_TIMEOUT_MS,
  selectSessionHandoff,
  selectSessionHandoffHeld,
  transitionSessionHandoff,
  type SessionHandoffEvent,
  type SessionHandoffState,
} from "./handoff-machine"

const handoff = (id: string) => ({ message: { id, type: "user" as const, text: id, time: { created: 1 } } })
const set = (id: string): SessionHandoffEvent => ({ type: "handoff.set", sessionID: "ses_1", handoff: handoff(id) })

function replay(events: SessionHandoffEvent[], from = createSessionHandoffState()) {
  return events.reduce<{ state: SessionHandoffState; effects: readonly unknown[] }[]>(
    (steps, event) => {
      steps.push(transitionSessionHandoff(steps.at(-1)?.state ?? from, event))

      return steps
    },
    [],
  )
}

describe("transitionSessionHandoff", () => {
  test("syncs and clears a settled prompt whose echo never arrives", () => {
    const steps = replay([
      set("msg_1"),
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "echo.timed-out", sessionID: "ses_1", attempt: 2 },
      { type: "sync.settled", sessionID: "ses_1", attempt: 3 },
    ])

    expect(steps[1]?.effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "echo", attempt: 2, delayMs: HANDOFF_ECHO_TIMEOUT_MS },
    ])
    expect(steps[2]?.effects).toEqual([
      { type: "sync", sessionID: "ses_1", attempt: 3 },
      { type: "timer.set", sessionID: "ses_1", timer: "sync", attempt: 3, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ])
    expect(selectSessionHandoff(steps[3]!.state, "ses_1")).toBeUndefined()
  })

  test("waits for a disconnected stream, then syncs immediately after reconnect", () => {
    const steps = replay([
      set("msg_1"),
      { type: "connection.changed", connected: false },
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "connection.changed", connected: true },
    ])

    expect(steps[2]?.effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "echo", attempt: 2, delayMs: HANDOFF_SEND_TIMEOUT_MS },
    ])
    expect(steps[3]?.effects).toEqual([
      { type: "sync", sessionID: "ses_1", attempt: 2 },
      { type: "timer.set", sessionID: "ses_1", timer: "sync", attempt: 2, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ])
  })

  test("fences old timers after a newer prompt replaces the handoff", () => {
    const steps = replay([set("msg_1"), set("msg_2"), { type: "sending.timed-out", sessionID: "ses_1", attempt: 1 }])

    expect(selectSessionHandoff(steps[2]!.state, "ses_1")?.message.id).toBe("msg_2")
    expect(steps[2]?.effects).toEqual([])
  })

  test("holds an unsent prompt without a timeout and replaces it when sending starts", () => {
    const held = transitionSessionHandoff(createSessionHandoffState(), {
      type: "handoff.held",
      sessionID: "ses_1",
      handoff: handoff("msg_1"),
    })
    expect(held.effects).toEqual([])
    expect(selectSessionHandoffHeld(held.state, "ses_1", "msg_1")).toBeTrue()

    const sending = transitionSessionHandoff(held.state, set("msg_1"))
    expect(selectSessionHandoffHeld(sending.state, "ses_1", "msg_1")).toBeFalse()
    expect(sending.effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "sending", attempt: 2, delayMs: HANDOFF_SEND_TIMEOUT_MS },
    ])
  })
})
