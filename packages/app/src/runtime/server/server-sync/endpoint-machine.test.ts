import { describe, expect, test } from "bun:test"
import {
  createEndpointSyncState,
  transitionEndpointSync,
  type EndpointSyncEffect,
  type EndpointSyncEvent,
  type EndpointSyncState,
} from "./endpoint-machine"

const first = { url: "http://127.0.0.1:4101", password: "first" }
const second = { url: "http://127.0.0.1:4102", password: "second" }
const third = { url: "http://127.0.0.1:4103", password: "third" }

function replay(events: EndpointSyncEvent[], state: EndpointSyncState = createEndpointSyncState(first)) {
  return events.reduce<{ state: EndpointSyncState; effects: EndpointSyncEffect[] }>(
    (result, event) => {
      const next = transitionEndpointSync(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("transitionEndpointSync", () => {
  test("keeps an endpoint reported while an older reconnect is resolving", () => {
    const result = replay([
      { type: "resolve.started" },
      { type: "endpoint.reported", http: third },
      { type: "resolve.succeeded", attempt: 1, http: second },
    ])

    expect(result.effects).toEqual([{ type: "transport.update", http: third }, { type: "stream.resync" }])
    expect(result.state).toEqual({ type: "idle", http: third, attempt: 1 })
  })

  test("updates once for a resolved endpoint and ignores its reactive echo", () => {
    const resolved = replay([{ type: "resolve.started" }, { type: "resolve.succeeded", attempt: 1, http: second }])
    expect(resolved.effects).toEqual([{ type: "transport.update", http: second }])
    expect(transitionEndpointSync(resolved.state, { type: "endpoint.reported", http: { ...second } }).effects).toEqual([])
  })

  test("ignores stale attempts, failures, and every event after disposal", () => {
    const resolving = replay([{ type: "resolve.started" }, { type: "resolve.started" }]).state
    expect(transitionEndpointSync(resolving, { type: "resolve.failed", attempt: 1 }).state).toBe(resolving)
    const disposed = transitionEndpointSync(resolving, { type: "disposed" }).state

    for (const event of [
      { type: "resolve.succeeded", attempt: 2, http: second },
      { type: "endpoint.reported", http: third },
      { type: "resolve.started" },
    ] satisfies EndpointSyncEvent[]) {
      expect(transitionEndpointSync(disposed, event)).toEqual({ state: disposed, effects: [] })
    }
  })
})
