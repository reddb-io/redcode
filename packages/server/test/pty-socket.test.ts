import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Option, Result } from "effect"
import { it } from "../../core/test/lib/effect"
import { runPtySocket } from "../src/handlers/pty-socket"
import { PtySockets } from "../src/pty-sockets"

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
    yield* sockets.register(Deferred.succeed(signaled).pipe(Effect.andThen(Deferred.await(closed))))

    const shutdown = yield* Effect.forkChild(sockets.shutdown)
    yield* Deferred.await(signaled)
    expect(Option.isNone(yield* Fiber.await(shutdown).pipe(Effect.timeoutOption("10 millis")))).toBeTrue()
    yield* Deferred.succeed(closed)
    yield* Fiber.join(shutdown)
  }),
)
