import { describe, expect, test } from "bun:test"
import { encodeEvent } from "../src/handlers/event"

describe("event stream encoding", () => {
  test("skips a live event the v2 protocol does not describe instead of ending the stream", () => {
    const sessionID = "ses_embedded_encode"
    expect(
      encodeEvent({
        id: "evt_status",
        type: "session.status",
        data: { sessionID, status: { type: "busy", phase: "preparing", step: 1, since: 1 } },
      }),
    ).toBeUndefined()
    expect(encodeEvent({ id: "evt_idle", type: "session.idle", data: { sessionID } })).toBeUndefined()
  })

  test("still encodes events the v2 protocol describes", () => {
    expect(encodeEvent({ id: "evt_connected", type: "server.connected", data: {} })).toMatchObject({
      type: "server.connected",
    })
  })
})
