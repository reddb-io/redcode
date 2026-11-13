import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber, Schema, Stream } from "effect"
import { Event } from "@opencode/schema/event"
import { EventBuffer } from "@opencode/core/event/buffer"

const Message = Event.ephemeral({ type: "test.buffer", schema: { text: Schema.String } })
const message = (text: string) => ({ id: Event.ID.create(), type: Message.type, created: 1, data: { text } })

describe("EventBuffer", () => {
  test("spills encrypted events, preserves order and removes the file after draining", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: root, memoryEvents: 1, memoryBytes: 1024 })
            const events = [message("first"), message("private session content"), message("third")]
            for (const event of events) yield* buffer.offer(event, Message)
            const directories = yield* Effect.promise(() => readdir(root))
            expect(directories).toHaveLength(1)
            const encrypted = yield* Effect.promise(() => readFile(path.join(root, directories[0]!, "0")))
            expect(encrypted.includes(Buffer.from("private session content"))).toBe(false)
            const received = yield* buffer.stream.pipe(Stream.take(3), Stream.runCollect)
            expect(Array.from(received)).toEqual(events)
            expect(yield* Effect.promise(() => readdir(root))).toEqual([])
          }),
        ),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("removes unread encrypted spill files when its scope closes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: root, memoryEvents: 0 })
            yield* buffer.offer(message("unread"), Message)
            expect(yield* Effect.promise(() => readdir(root))).toHaveLength(1)
          }),
        ),
      )
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("removes consumed segments while later events remain queued", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: root, memoryEvents: 0 })
            const events = Array.from({ length: 3 }, (_, index) => message(`${index}:${"x".repeat(3 * 1024 * 1024)}`))
            for (const event of events) yield* buffer.offer(event, Message)
            const [directory] = yield* Effect.promise(() => readdir(root))
            expect((yield* Effect.promise(() => readdir(path.join(root, directory!)))).length).toBe(3)
            expect(Array.from(yield* buffer.stream.pipe(Stream.take(1), Stream.runCollect))).toEqual([events[0]])
            expect((yield* Effect.promise(() => readdir(path.join(root, directory!)))).length).toBe(2)
            expect(Array.from(yield* buffer.stream.pipe(Stream.take(2), Stream.runCollect))).toEqual(events.slice(1))
            expect(yield* Effect.promise(() => readdir(root))).toEqual([])
          }),
        ),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("restores values transformed by the event schema after spilling", async () => {
    const definition = Event.ephemeral({ type: "test.buffer.date", schema: { date: Schema.DateFromString } })
    const event = { id: Event.ID.create(), type: definition.type, created: 1, data: { date: new Date(0) } }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const buffer = yield* EventBuffer.make({ memoryEvents: 0 })
          yield* buffer.offer(event, definition)
          const received = Array.from(yield* buffer.stream.pipe(Stream.take(1), Stream.runCollect))
          expect(received).toEqual([event])
          expect((received[0]?.data as { date: Date }).date).toBeInstanceOf(Date)
        }),
      ),
    )
  })

  test("retries a corrupted record header without allocating its declared size or dropping the event", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: root, memoryEvents: 0 })
            const event = message("survives a failed read")
            yield* buffer.offer(event, Message)
            const [directory] = yield* Effect.promise(() => readdir(root))
            const file = path.join(root, directory!, "0")
            const original = yield* Effect.promise(() => readFile(file))
          yield* Effect.promise(() => writeFile(file, Buffer.from([255, 255, 255, 255])))
            const receiving = yield* buffer.stream.pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.forkChild({ startImmediately: true }),
            )
            yield* Effect.sleep("100 millis")
            yield* Effect.promise(() => writeFile(file, original))
            expect(Array.from(yield* Fiber.join(receiving))).toEqual([event])
          }),
        ),
      )
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("retains an event and backpressures the publisher when the spill directory is unavailable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: path.join(root, "missing"), memoryEvents: 0 })
            const event = message("not lost")
            const publishing = yield* buffer.offer(event, Message).pipe(Effect.forkChild({ startImmediately: true }))
            const received = yield* buffer.stream.pipe(Stream.take(1), Stream.runCollect)
            expect(Array.from(received)).toEqual([event])
            yield* Fiber.join(publishing)
          }),
        ),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("preserves order across memory and backpressure when disk is unavailable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redcode-buffer-test-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const buffer = yield* EventBuffer.make({ directory: path.join(root, "missing"), memoryEvents: 1 })
            const events = [message("first"), message("second"), message("third")]
            yield* buffer.offer(events[0]!, Message)
            const second = yield* buffer.offer(events[1]!, Message).pipe(Effect.forkChild({ startImmediately: true }))
            const third = yield* buffer.offer(events[2]!, Message).pipe(Effect.forkChild({ startImmediately: true }))
            const received = yield* buffer.stream.pipe(Stream.take(3), Stream.runCollect)
            yield* Fiber.join(second)
            yield* Fiber.join(third)
            expect(Array.from(received)).toEqual(events)
          }),
        ),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("backpressures instead of growing the schema registry without losing an event", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const buffer = yield* EventBuffer.make({ memoryEvents: 0 })
          const events = Array.from({ length: 1025 }, (_, index) => message(`event-${index}`))
          const definitions = events.map(() => Event.ephemeral({ type: Message.type, schema: { text: Schema.String } }))
          for (let index = 0; index < 1024; index++) yield* buffer.offer(events[index]!, definitions[index]!)
          const last = yield* buffer
            .offer(events[1024]!, definitions[1024]!)
            .pipe(Effect.forkChild({ startImmediately: true }))
          const received = yield* buffer.stream.pipe(Stream.take(events.length), Stream.runCollect)
          yield* Fiber.join(last)
          expect(Array.from(received)).toEqual(events)
        }),
      ),
    )
  })
})
