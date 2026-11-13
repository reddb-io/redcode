import { mkdtemp, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Deferred, Effect, Fiber, Option, Schema, Stream } from "effect"
import { Event } from "@opencode/schema/event"
import { EventBuffer } from "../src/event/buffer.js"

const definition = Event.ephemeral({ type: "test.buffer.full", schema: { text: Schema.String } })
const event = (text: string) => ({ id: Event.ID.create(), type: definition.type, created: Date.now(), data: { text } })
const root = await mkdtemp(path.join(tmpdir(), "redcode-full-repro-"))

try {
  const completed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // A nonexistent child deterministically simulates an unavailable spill directory.
        const buffer = yield* EventBuffer.make({ directory: path.join(root, "unavailable"), memoryEvents: 1 })
        const entered = yield* Deferred.make<void>()
        const proceed = yield* Deferred.make<void>()
        yield* buffer.offer(event("first"), definition)
        const consumer = yield* buffer.stream.pipe(
          Stream.runForEach((item) =>
            Effect.gen(function* () {
              if ((item.data as { text: string }).text !== "first") return
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(proceed)
              yield* buffer.offer(event("nested"), definition)
            }),
          ),
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.await(entered)
        yield* buffer.offer(event("second"), definition)
        const publisher = yield* buffer
          .offer(event("third"), definition)
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Effect.sleep("100 millis")
        yield* Deferred.succeed(proceed, undefined)
        const result = yield* Fiber.await(publisher).pipe(Effect.timeoutOption("1 second"))
        yield* buffer.close
        yield* Fiber.interrupt(consumer)
        yield* Fiber.interrupt(publisher)
        return Option.isSome(result)
      }),
    ),
  )
  process.stdout.write(
    completed ? "Publisher completed.\n" : "Deadlock reproduced: publisher and consumer are waiting.\n",
  )
  if (!completed) process.exitCode = 1
} finally {
  await rmdir(root)
}
