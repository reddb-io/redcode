import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Option, Result } from "effect"
import { it } from "../../core/test/lib/effect"
import { runPtySocket } from "../src/handlers/pty-socket"
import { makePtyOutbox } from "../src/handlers/pty-outbox"
import { PtySockets } from "../src/pty-sockets"
import { Socket } from "effect/unstable/socket"

it.live("detaches when the socket fails while the outbox drain is blocked", () =>
  Effect.gen(function* () {
    const state = { detached: false }
    const result = yield* runPtySocket(Effect.never, Effect.fail("socket closed"), () => {
      state.detached = true
    }).pipe(Effect.result, Effect.timeoutOption("100 millis"))

    expect(Option.isSome(result) && Result.isFailure(result.value)).toBeTrue()
    expect(state.detached).toBeTrue()
  }),
)

it.live("signals active PTY sockets and waits for their close on shutdown", () =>
  Effect.gen(function* () {
    const sockets = yield* PtySockets.make
    const signaled = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    yield* sockets.register(Deferred.succeed(signaled, undefined).pipe(Effect.andThen(Deferred.await(closed))))

    const shutdown = yield* Effect.forkChild(sockets.shutdown)
    yield* Deferred.await(signaled)
    expect(Option.isNone(yield* Fiber.await(shutdown).pipe(Effect.timeoutOption("10 millis")))).toBeTrue()
    yield* Deferred.succeed(closed, undefined)
    yield* Fiber.join(shutdown)
  }),
)

it.live("disconnects a stalled terminal client when its outgoing byte or frame budget is exhausted", () =>
  Effect.gen(function* () {
    for (const chunk of ["x", Buffer.alloc(1024 * 1024), "界".repeat(350_000)]) {
      const started = yield* Deferred.make<void>()
      const sent: Array<string | Uint8Array | Socket.CloseEvent> = []
      const outbox = yield* makePtyOutbox((frame) => {
        sent.push(frame)
        return frame instanceof Socket.CloseEvent
          ? Effect.void
          : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      })
      let detached = false
      const connection = yield* Effect.forkChild(runPtySocket(outbox.drain, Effect.never, () => (detached = true)))
      outbox.offer("first")
      yield* Deferred.await(started)
      let accepted = 0
      while (accepted < 1100 && outbox.offer(chunk)) accepted++
      expect(accepted).toBeLessThanOrEqual(typeof chunk === "string" && chunk.length === 1 ? 1024 : 8)
      expect(outbox.offer("late output")).toBeFalse()
      yield* Fiber.join(connection)
      expect(sent.at(-1)).toMatchObject({ code: 1013 })
      expect(detached).toBeTrue()
    }
  }),
)

it.live("preserves terminal replay and live output order before a normal close", () =>
  Effect.gen(function* () {
    const sent: Array<string | Uint8Array | Socket.CloseEvent> = []
    const outbox = yield* makePtyOutbox((frame) =>
      Effect.sync(() => {
        sent.push(frame)
      }),
    )
    const close = new Socket.CloseEvent(1000)
    for (const frame of ["replay", "cursor", "live", close]) expect(outbox.offer(frame)).toBeTrue()
    yield* outbox.drain
    expect(sent).toEqual(["replay", "cursor", "live", close])
    expect(outbox.offer("after close")).toBeFalse()
  }),
)
