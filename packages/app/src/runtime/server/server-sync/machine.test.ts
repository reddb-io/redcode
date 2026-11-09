import { describe, expect, test } from "bun:test"
import type { ServerConnectionStatus } from "../client"
import {
  transitionConnectionSync,
  type ConnectionSyncEffect,
  type ConnectionSyncEvent,
  type ConnectionSyncState,
} from "./machine"

const status = (value: ServerConnectionStatus): ConnectionSyncEvent => ({ type: "status.changed", status: value })
const handshake = (reset = true): ConnectionSyncEvent => ({ type: "handshake.received", reset })

function replay(events: ConnectionSyncEvent[], state: ConnectionSyncState = { type: "idle" }) {
  return events.reduce<{ state: ConnectionSyncState; effects: ConnectionSyncEffect[] }>(
    (result, event) => {
      const next = transitionConnectionSync(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("transitionConnectionSync", () => {
  test("does not sync on a buffered handshake from a stream that already dropped", () => {
    const dropped = replay([status("connecting"), status("connected"), status("reconnecting"), handshake()])
    expect(dropped.effects).toEqual([])

    const next = replay([status("connected"), handshake()], dropped.state)
    expect(next.effects).toEqual([{ type: "invalidate" }, { type: "sync", restart: true }])
  })

  test("syncs once per live connection in either event order", () => {
    const result = replay([
      status("connecting"),
      status("connected"),
      handshake(),
      status("reconnecting"),
      handshake(),
      status("connected"),
      handshake(),
    ])

    expect(result.effects).toEqual([
      { type: "sync", restart: false },
      { type: "invalidate" },
      { type: "sync", restart: true },
    ])
    expect(result.state).toEqual({ type: "live" })
  })

  test("keeps cached data during disconnects and ignores events after disposal", () => {
    expect(replay([status("connecting"), status("reconnecting"), status("connecting")]).effects).toEqual([])
    const disposed = replay([status("connected"), { type: "disposed" }]).state

    for (const event of [status("reconnecting"), status("connected"), handshake()]) {
      const result = transitionConnectionSync(disposed, event)
      expect(result.state).toBe(disposed)
      expect(result.effects).toEqual([])
    }
  })

  test("resumes without invalidating or restarting when the server replayed the missing gap", () => {
    const result = replay([
      status("connected"),
      handshake(false),
      status("reconnecting"),
      status("connected"),
      handshake(false),
    ])

    expect(result.effects).toEqual([
      { type: "sync", restart: false },
      { type: "sync", restart: false },
    ])
  })
})
