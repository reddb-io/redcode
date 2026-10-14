import { Deferred, Effect, Exit, Queue } from "effect"
import { Socket } from "effect/unstable/socket"

type Frame = string | Uint8Array | Socket.CloseEvent

const MAX_BYTES = 8 * 1024 * 1024
const MAX_FRAMES = 1024

const size = (frame: Frame) =>
  typeof frame === "string" ? Buffer.byteLength(frame) : frame instanceof Uint8Array ? frame.byteLength : 0

/** One ordered writer for replay, live terminal output and closure. */
export const makePtyOutbox = <E, R>(write: (frame: Frame) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<Frame>(MAX_FRAMES)
    const overflow = yield* Deferred.make<void>()
    const state = { bytes: 0, closed: false }
    const shutdown = Effect.sync(() => {
      state.closed = true
      state.bytes = 0
    }).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid)
    yield* Effect.addFinalizer(() => shutdown)

    const drain = Effect.gen(function* () {
      while (true) {
        const frame = yield* Queue.take(queue)
        state.bytes -= size(frame)
        yield* write(frame)
        if (frame instanceof Socket.CloseEvent) return
      }
    })
    return {
      offer: (frame: Frame) => {
        if (state.closed) return false
        const bytes = size(frame)
        if (state.bytes + bytes <= MAX_BYTES && Queue.offerUnsafe(queue, frame)) {
          state.bytes += bytes
          if (frame instanceof Socket.CloseEvent) state.closed = true
          return true
        }
        // A suspended Desktop or a slow network must not retain an unlimited terminal transcript.
        // Close this connection so the client can reconnect using the terminal's replay cursor.
        state.closed = true
        state.bytes = 0
        while (true) {
          const frame = Queue.takeUnsafe(queue)
          if (!frame || Exit.isFailure(frame)) break
        }
        Deferred.doneUnsafe(overflow, Exit.void)
        return false
      },
      drain: Effect.raceFirst(drain, Deferred.await(overflow)).pipe(
        Effect.andThen(() =>
          Deferred.isDone(overflow).pipe(
            Effect.flatMap((full) =>
              full ? write(new Socket.CloseEvent(1013, "terminal client too slow")) : Effect.void,
            ),
          ),
        ),
        Effect.ensuring(shutdown),
      ),
    }
  })
