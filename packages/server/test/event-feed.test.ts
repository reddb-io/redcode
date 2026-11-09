import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/schema/credential"
import { Event } from "@opencode/schema/event"
import { IntegrationID } from "@opencode/schema/integration-id"
import { Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"

const Internal = Bus.ephemeral({ type: "test.internal", schema: { value: Schema.String } })
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const bytes = (value: string) => encoder.encode(value)
const text = (value: Uint8Array) => decoder.decode(value)
const texts = (values: Iterable<Uint8Array>) => Array.from(values, text)

const event = (id: string): Event.Payload<typeof Agent.Event.Updated> => ({
  id: Event.ID.make(`evt_${id}`),
  created: Date.now(),
  type: Agent.Event.Updated.type,
  data: {},
})

const internal = (value: string): Event.Payload<typeof Internal> => ({
  id: Event.ID.create(),
  created: Date.now(),
  type: Internal.type,
  data: { value },
})

function makeSource() {
  let subscriber: Bus.Subscriber | undefined
  return {
    observe: (next: Bus.Subscriber) =>
      Effect.sync(() => {
        subscriber = next
        return Effect.sync(() => {
          if (subscriber === next) subscriber = undefined
        })
      }),
    publish: (event: Event.Payload) => Effect.suspend(() => (subscriber ? subscriber(event) : Effect.void)),
  }
}

describe("EventFeed", () => {
  test("preserves the public SSE frame encoding", () => {
    const payload = event("wire")
    expect(EventFeed.frame(payload)).toBe(`data: ${JSON.stringify(payload)}\n\n`)
    expect(text(EventFeed.frameBytes(payload))).toBe(EventFeed.frame(payload))
    expect(EventFeed.frame(payload, "epoch:7")).toBe(`id: epoch:7\ndata: ${JSON.stringify(payload)}\n\n`)
  })

  it.effect("encodes once and delivers the same frame to every subscriber", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return bytes(event.type)
        },
      })
      const first = yield* feed.subscribe
      const second = yield* feed.subscribe
      const left = yield* first.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* second.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("example"))

      const leftValues = Array.from(yield* Fiber.join(left))
      const rightValues = Array.from(yield* Fiber.join(right))
      expect(leftValues[0]).toBe(rightValues[0])
      expect([texts(leftValues), texts(rightValues)]).toEqual([
        [Agent.Event.Updated.type],
        [Agent.Event.Updated.type],
      ])
      expect(encodes).toBe(1)
    }),
  )

  it.effect("counts live client surfaces and de-duplicates reconnects by client identity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe)
      yield* feed.subscribeClient({ id: "desktop-one", surface: "desktop", version: "test" })
      yield* feed.subscribeClient({ id: "desktop-one", surface: "desktop", version: "test" })
      yield* feed.subscribeClient({ id: "tui-one", surface: "tui" })
      yield* feed.subscribe

      expect(yield* feed.snapshot).toEqual({
        total: 3,
        desktop: 1,
        web: 0,
        tui: 1,
        cli: 0,
        api: 0,
        automation: 0,
        worker: 0,
        unknown: 1,
      })
    }),
  )

  it.effect("fails only the subscriber that exceeds its lag capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 1,
        encode: (event) => bytes(event.id),
      })
      const slow = yield* feed.subscribe
      const fast = yield* feed.subscribe
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const received = new Array<string>()
      const fastFiber = yield* fast.pipe(
        Stream.take(3),
        Stream.runForEach((frame) =>
          Effect.sync(() => received.push(text(frame))).pipe(
            Effect.andThen(
              text(frame) === "evt_one"
                ? Deferred.succeed(first, undefined)
                : text(frame) === "evt_two"
                  ? Deferred.succeed(second, undefined)
                  : Effect.void,
            ),
          ),
        ),
        Effect.forkScoped,
      )

      yield* source.publish(event("one"))
      yield* Deferred.await(first)
      yield* source.publish(event("two"))
      yield* Deferred.await(second)
      yield* source.publish(event("three"))

      yield* Fiber.join(fastFiber)

      const result = yield* slow.pipe(Stream.runCollect, Effect.exit)
      expect(received).toEqual(["evt_one", "evt_two", "evt_three"])
      expect(Exit.isFailure(result)).toBeTrue()
      if (Exit.isSuccess(result)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(EventFeed.SubscriberOverflowError)
    }),
  )

  it.effect("bounds retained event bytes for a slow subscriber", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 10,
        byteCapacity: 6,
        encode: () => bytes("éé"),
      })
      const slow = yield* feed.subscribe

      yield* source.publish(event("one"))
      yield* source.publish(event("two"))

      const result = yield* slow.pipe(Stream.runCollect, Effect.exit)
      expect(Exit.isFailure(result)).toBeTrue()
      if (Exit.isSuccess(result)) return
      const error = Option.getOrUndefined(Exit.findErrorOption(result))
      expect(error).toBeInstanceOf(EventFeed.SubscriberOverflowError)
      if (!(error instanceof EventFeed.SubscriberOverflowError)) return
      expect(error.byteCapacity).toBe(6)
      expect(error.attemptedBytes).toBe(8)
      expect(yield* feed.diagnostics).toEqual({
        subscribers: 0,
        queuedBytes: 0,
        peakQueuedBytes: 4,
        frames: 2,
        encodedBytes: 8,
        largestFrameBytes: 4,
        frameBytesP50: 4,
        frameBytesP95: 4,
        frameBytesP99: 4,
        overflows: 1,
        acknowledgements: 0,
        replayedFrames: 0,
        replayMisses: 0,
        retainedFrames: 2,
        retainedBytes: 8,
        cursor: 2,
        oldestCursor: 1,
        acknowledgedClients: 0,
        maxAcknowledgementLag: 0,
      })
    }),
  )

  it.effect("releases a subscriber byte budget as frames are consumed", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 10,
        byteCapacity: 8,
        encode: () => bytes("1234"),
      })
      const stream = yield* feed.subscribe
      const first = yield* Deferred.make<void>()
      const received = new Array<string>()
      const fiber = yield* stream.pipe(
        Stream.take(2),
        Stream.runForEach((value) =>
          Effect.sync(() => {
            received.push(text(value))
            return received.length
          }).pipe(
            Effect.flatMap((count) => (count === 1 ? Deferred.succeed(first, undefined) : Effect.void)),
          ),
        ),
        Effect.forkScoped,
      )

      yield* source.publish(event("one"))
      yield* Deferred.await(first)
      yield* source.publish(event("two"))

      yield* Fiber.join(fiber)
      expect(received).toEqual(["1234", "1234"])
    }),
  )

  it.effect("delivers global credential events to public subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => bytes(event.type) })
      const stream = yield* feed.subscribe
      const received = yield* stream.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish({
        id: Event.ID.create(),
        created: Date.now(),
        type: Credential.Event.Switched.type,
        data: {
          credentialID: Credential.ID.make("cred_test"),
          integrationID: IntegrationID.make("openai"),
        },
      })

      expect(texts(yield* Fiber.join(received))).toEqual([Credential.Event.Switched.type])
    }),
  )

  it.effect("filters internal events before they consume subscriber capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { capacity: 1, encode: (event) => bytes(event.type) })
      const stream = yield* feed.subscribe

      yield* source.publish(internal("one"))
      yield* source.publish(internal("two"))
      yield* source.publish(event("public"))

      expect(texts(yield* stream.pipe(Stream.take(1), Stream.runCollect))).toEqual([Agent.Event.Updated.type])
    }),
  )

  it.effect("disconnects current subscribers after an encoding failure and continues for later subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          if (event.id === Event.ID.make("evt_bad")) throw new Error("invalid event")
          return bytes(event.id)
        },
      })
      const current = yield* feed.subscribe
      const failed = yield* current.pipe(Stream.runCollect, Effect.exit, Effect.forkScoped)

      yield* source.publish(event("bad"))
      const exit = yield* Fiber.join(failed)

      const next = yield* feed.subscribe
      const received = yield* next.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("good"))

      expect(Exit.isFailure(exit)).toBeTrue()
      if (Exit.isSuccess(exit)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBeInstanceOf(EventFeed.EncodingError)
      expect(texts(yield* Fiber.join(received))).toEqual(["evt_good"])
    }),
  )

  it.effect("replays events published while a client is disconnected without duplicating live events", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (item, id) => bytes(`${id}|${item.id}`) })
      const first = yield* feed.connectClient({ id: "desktop-one", surface: "desktop" })
      yield* source.publish(event("one"))
      expect(texts(yield* first.stream.pipe(Stream.take(1), Stream.runCollect))).toEqual([
        `${first.epoch}:1|evt_one`,
      ])

      yield* source.publish(event("two"))
      const resumed = yield* feed.connectClient(
        { id: "desktop-one", surface: "desktop" },
        { epoch: first.epoch, cursor: 1 },
      )
      const received = yield* resumed.stream.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("three"))

      expect(resumed.reset).toBeFalse()
      expect(resumed.replayed).toBe(1)
      expect(texts(yield* Fiber.join(received))).toEqual([
        `${first.epoch}:2|evt_two`,
        `${first.epoch}:3|evt_three`,
      ])
    }),
  )

  it.effect("requests a snapshot reset when the replay cursor is stale or belongs to another epoch", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        replayCapacity: 1,
        encode: (item, id) => bytes(`${id}|${item.id}`),
      })
      const initial = yield* feed.connectClient({ id: "web-one", surface: "web" })
      yield* source.publish(event("one"))
      yield* source.publish(event("two"))

      const stale = yield* feed.connectClient(
        { id: "web-one", surface: "web" },
        { epoch: initial.epoch, cursor: 0 },
      )
      const wrongEpoch = yield* feed.connectClient(
        { id: "web-two", surface: "web" },
        { epoch: "old-process", cursor: 2 },
      )

      expect(stale.reset).toBeTrue()
      expect(stale.replayed).toBe(0)
      expect(wrongEpoch.reset).toBeTrue()
      expect((yield* feed.diagnostics).replayMisses).toBe(2)
    }),
  )

  it.effect("records monotonic acknowledgements without trusting invalid cursors", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe)
      const connection = yield* feed.connectClient({ id: "tui-one", surface: "tui" })
      yield* source.publish(event("one"))

      yield* feed.acknowledge("tui-one", { epoch: connection.epoch, cursor: 1 })
      yield* feed.acknowledge("tui-one", { epoch: connection.epoch, cursor: 1 })
      yield* feed.acknowledge("tui-one", { epoch: "wrong", cursor: 1 })
      yield* feed.acknowledge("tui-one", { epoch: connection.epoch, cursor: 2 })

      expect(yield* feed.diagnostics).toMatchObject({
        acknowledgements: 1,
        acknowledgedClients: 1,
        maxAcknowledgementLag: 0,
      })
    }),
  )
})
