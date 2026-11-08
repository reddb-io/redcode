import { describe, expect, test } from "bun:test"
import {
  createRequestQueueState,
  selectInflightCount,
  selectQueuedCount,
  transitionRequestQueue,
  type RequestPriority,
  type RequestQueueEffect,
  type RequestQueueEvent,
  type RequestQueueState,
} from "./request-queue-machine"

const config = { limit: 1, slowLimit: 1, stallMs: 2_000 }
const arrive = (url: string, now: number, priority: RequestPriority = 0, slow = false): RequestQueueEvent => ({
  type: "request.arrived",
  method: priority === 2 ? "POST" : "GET",
  url,
  slow,
  priority,
  now,
})

function replay(events: readonly RequestQueueEvent[], from = createRequestQueueState()) {
  return events.reduce<{ state: RequestQueueState; effects: RequestQueueEffect[] }>(
    (result, event) => {
      const next = transitionRequestQueue(result.state, event, config)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

describe("transitionRequestQueue", () => {
  test("removes an aborted waiter without ever starting it", () => {
    const queued = replay([arrive("/stuck", 0), arrive("/second", 0)])
    const aborted = transitionRequestQueue(queued.state, { type: "request.aborted", id: 2, now: 10 }, config)

    expect(selectQueuedCount(aborted.state)).toBe(0)
    expect(selectInflightCount(aborted.state)).toBe(1)
    expect(aborted.effects).toEqual([{ type: "watcher.stop" }])
  })

  test("inserts writes ahead of background reads without starving stall diagnostics", () => {
    const queued = replay([arrive("/busy", 0), arrive("/background", 0), arrive("/write", 1_900, 2)])
    expect(queued.state.status === "queued" && queued.state.waiting.map((entry) => entry.url)).toEqual([
      "/write",
      "/background",
    ])
    expect(transitionRequestQueue(queued.state, { type: "watch.due", now: 2_000 }, config).effects.map((x) => x.type)).toEqual([
      "watcher.start",
      "log.stall",
    ])
  })

  test("disposal cancels every request and ignores later events", () => {
    const queued = replay([arrive("/busy", 0), arrive("/a", 0), arrive("/b", 0)]).state
    const disposed = transitionRequestQueue(queued, { type: "disposed" }, config)

    expect(disposed.effects).toEqual([{ type: "watcher.stop" }, { type: "request.cancel", ids: [2, 3, 1] }])
    expect(transitionRequestQueue(disposed.state, arrive("/late", 1), config)).toEqual({
      state: disposed.state,
      effects: [],
    })
  })
})
