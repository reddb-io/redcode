import { describe, expect, test } from "bun:test"
import { encodeEvent } from "../src/handlers/event"

describe("event stream encoding", () => {
  const sessionID = "ses_embedded_encode"

  test("encodes session.status busy, retry and idle for v2 clients", () => {
    const statuses = [
      { type: "busy", phase: "preparing", step: 1, since: 1 },
      { type: "busy", phase: "tool", tool: "bash", step: 2, since: 5 },
      { type: "retry", attempt: 1, message: "Rate limited", next: 10 },
      { type: "idle" },
    ]
    for (const status of statuses)
      expect(encodeEvent({ id: "evt_status", type: "session.status", data: { sessionID, status } })).toMatchObject({
        type: "session.status",
        data: { sessionID, status },
      })
  })

  test("skips a live event the v2 protocol does not describe instead of ending the stream", () => {
    expect(encodeEvent({ id: "evt_idle", type: "session.idle", data: { sessionID } })).toBeUndefined()
  })

  test("still encodes events the v2 protocol describes", () => {
    expect(encodeEvent({ id: "evt_connected", type: "server.connected", data: {} })).toMatchObject({
      type: "server.connected",
    })
  })
})
