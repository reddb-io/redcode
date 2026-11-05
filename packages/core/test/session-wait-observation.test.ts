import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import type { Bus } from "@opencode/core/bus"
import { SessionWait } from "@opencode/core/session/wait"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"

test("transient waits are session-scoped and settle even when work fails", async () => {
  const events: Array<{ sessionID: string; waits: readonly { kind: string }[] }> = []
  const bus = {
    publish: (_event: unknown, data: { sessionID: string; waits: readonly { kind: string }[] }) =>
      Effect.sync(() => void events.push(data)),
  } as unknown as Pick<Bus.Interface, "publish">
  const first = Session.ID.make("ses_wait_first")
  const second = Session.ID.make("ses_wait_second")
  await Effect.runPromise(
    Effect.gen(function* () {
      const stopFirst = yield* SessionWait.start(bus, { sessionID: first, kind: "mcp", target: "tools" })
      const stopSecond = yield* SessionWait.start(bus, { sessionID: second, kind: "model", target: "provider/model" })
      expect(SessionWait.list(first).map((item) => item.kind)).toEqual(["mcp"])
      expect(SessionWait.list(second).map((item) => item.kind)).toEqual(["model"])
      yield* Effect.fail("failure").pipe(Effect.ensuring(stopFirst), Effect.ignore)
      expect(SessionWait.list(first)).toEqual([])
      expect(SessionWait.list(second)).toHaveLength(1)
      yield* stopSecond
      yield* stopSecond
      expect(SessionWait.list(second)).toEqual([])
    }),
  )
  expect(events.map((event) => [event.sessionID, event.waits.map((wait) => wait.kind)])).toEqual([
    [first, ["mcp"]],
    [second, ["model"]],
    [first, []],
    [second, []],
  ])
})

test("MCP registration reports an actual pending startup and clears it on interruption", async () => {
  const sessionID = Session.ID.make("ses_mcp_wait")
  await Effect.runPromise(
    Effect.gen(function* () {
      const announced = yield* Deferred.make<void>()
      const bus = {
        publish: () => Deferred.succeed(announced, undefined).pipe(Effect.asVoid),
      } as unknown as Pick<Bus.Interface, "publish">
      const fiber = yield* SessionContext.waitForTools(
        bus,
        {
          starting: Effect.succeed(["slow-server"]),
          flush: Effect.never,
        },
        sessionID,
      ).pipe(Effect.forkChild)
      yield* Deferred.await(announced)
      expect(SessionWait.list(sessionID).map((wait) => wait.kind)).toEqual(["mcp"])
      yield* Fiber.interrupt(fiber)
      expect(SessionWait.list(sessionID)).toEqual([])
    }),
  )
})
