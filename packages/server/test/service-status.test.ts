import { expect, test } from "bun:test"
import { Cause, Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { Status } from "../src/service-status"

it.effect("moves from starting to ready", () =>
  Effect.gen(function* () {
    const status = yield* Status.make()
    expect(yield* status.current).toEqual({ type: "starting" })
    yield* status.ready
    expect(yield* status.current).toEqual({ type: "ready" })
  }),
)

it.effect("keeps a startup failure until shutdown", () =>
  Effect.gen(function* () {
    const status = yield* Status.make()
    yield* status.fail({ message: "first", log: "/tmp/opencode.log" })
    yield* status.ready
    yield* status.fail({ message: "second" })
    expect(yield* status.current).toEqual({ type: "failed", message: "first", log: "/tmp/opencode.log" })
  }),
)

test("reports the first line of a failed boot's error", () => {
  expect(Status.reason(Cause.fail(new Error("database is locked\n    at open (db.ts:1:1)")))).toBe("database is locked")
  expect(Status.reason(Cause.die("\n  plain defect  \nsecond line"))).toBe("plain defect")
  expect(Status.reason(Cause.fail({ code: 1 }))).toBeUndefined()
})

test("redacts credentials from a failure reason", () => {
  expect(Status.summarize("cannot reach postgres://admin:hunter2@db.internal:5432/app?sslkey=secret#frag")).toBe(
    "cannot reach postgres://db.internal:5432/app",
  )
  expect(Status.summarize("request failed with Authorization: Bearer abc.def-ghi")).toBe(
    "request failed with Authorization: Bearer [redacted:authorization]",
  )
  expect(Status.summarize("invalid config api_key=sk-live-123, password:'hunter2'")).toBe(
    "invalid config api_key=[redacted:api-key], password:'[redacted:password]'",
  )
  expect(Status.summarize("Unexpected token: } in JSON")).toBe("Unexpected token: } in JSON")
})

test("caps a long failure reason", () => {
  const summary = Status.summarize("x".repeat(1_000))
  expect(summary?.length).toBe(300)
  expect(summary?.endsWith("…")).toBe(true)
  expect(Status.summarize(" \n \n")).toBeUndefined()
})

it.effect("keeps stopping after shutdown begins", () =>
  Effect.gen(function* () {
    const status = yield* Status.make()

    yield* status.beginStopping
    expect(yield* status.current).toEqual({ type: "stopping" })
    yield* status.beginStopping
    expect(yield* status.current).toEqual({ type: "stopping" })
  }),
)
