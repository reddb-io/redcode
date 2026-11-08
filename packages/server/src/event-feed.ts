export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096
export const SubscriberByteCapacity = 4 * 1024 * 1024
const FrameSampleCapacity = 2_048
const encoder = new TextEncoder()

export class SubscriberOverflowError extends Schema.TaggedError<SubscriberOverflowError>()(
  "EventFeed.SubscriberOverflow",
  {
    capacity: Schema.Int,
    byteCapacity: Schema.Int,
    attemptedBytes: Schema.Int,
  },
) {}

export class EncodingError extends Schema.TaggedError<EncodingError>()("EventFeed.EncodingError", {
  eventID: Event.ID,
  eventType: Schema.String,
  cause: Schema.Defect(),
}) {}

export type Error = SubscriberOverflowError | EncodingError

export type Client = {
  readonly id?: string
  readonly surface: ClientPresence.Surface
  readonly version?: string
}

export type Diagnostics = {
  readonly subscribers: number
  readonly queuedBytes: number
  readonly peakQueuedBytes: number
  readonly frames: number
  readonly encodedBytes: number
  readonly largestFrameBytes: number
  readonly frameBytesP50: number
  readonly frameBytesP95: number
  readonly frameBytesP99: number
  readonly overflows: number
}

export interface Interface {
  /** Backward-compatible anonymous event subscription. */
  readonly subscribe: Effect.Effect<Stream.Stream<Uint8Array, Error>, never, Scope.Scope>
  readonly subscribeClient: (client: Client) => Effect.Effect<Stream.Stream<Uint8Array, Error>, never, Scope.Scope>
  readonly snapshot: Effect.Effect<ClientPresence.Snapshot>
  readonly diagnostics: Effect.Effect<Diagnostics>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function frameBytes(event: OpenCodeEvent) {
  return encoder.encode(frame(event))
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: {
    readonly capacity?: number
    readonly byteCapacity?: number
    readonly encode?: (event: OpenCodeEvent) => Uint8Array
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const byteCapacity = options?.byteCapacity ?? SubscriberByteCapacity
  const render = options?.encode ?? frameBytes
  type Subscriber = {
    readonly queue: Queue.Queue<Uint8Array, Error>
    readonly client: Client & { readonly id: string }
    bufferedBytes: number
  }
  const subscribers = new Map<Queue.Queue<Uint8Array, Error>, Subscriber>()
  let anonymous = 0
  const metrics = {
    queuedBytes: 0,
    peakQueuedBytes: 0,
    frames: 0,
    encodedBytes: 0,
    largestFrameBytes: 0,
    overflows: 0,
    samples: new Uint32Array(FrameSampleCapacity),
  }

  const release = (subscriber: Subscriber) => {
    metrics.queuedBytes = Math.max(0, metrics.queuedBytes - subscriber.bufferedBytes)
    subscriber.bufferedBytes = 0
  }

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.values())
      subscribers.clear()
      for (const subscriber of current) {
        release(subscriber)
        Queue.failCauseUnsafe(subscriber.queue, Cause.fail(error))
      }
    })

  const publish = Effect.fnUntraced(function* (event: Event.Payload) {
    if (!isOpenCodeEvent(event)) return
    if (subscribers.size === 0) return
    const encoded = yield* Effect.try({
      try: () => render(event),
      catch: (cause) => new EncodingError({ eventID: event.id, eventType: event.type, cause }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logError("Failed to encode public event", {
          eventID: error.eventID,
          eventType: error.eventType,
          cause: error.cause,
        }).pipe(Effect.andThen(fail(error)), Effect.as(undefined)),
      ),
    )
    if (encoded === undefined) return
    const bytes = encoded.byteLength
    metrics.samples[metrics.frames % FrameSampleCapacity] = bytes
    metrics.frames += 1
    metrics.encodedBytes += bytes
    metrics.largestFrameBytes = Math.max(metrics.largestFrameBytes, bytes)
    for (const [queue, subscriber] of subscribers) {
      const attemptedBytes = subscriber.bufferedBytes + bytes
      if (attemptedBytes <= byteCapacity && Queue.offerUnsafe(queue, encoded)) {
        subscriber.bufferedBytes = attemptedBytes
        metrics.queuedBytes += bytes
        metrics.peakQueuedBytes = Math.max(metrics.peakQueuedBytes, metrics.queuedBytes)
        continue
      }
      subscribers.delete(queue)
      metrics.overflows += 1
      release(subscriber)
      Queue.failCauseUnsafe(
        queue,
        Cause.fail(new SubscriberOverflowError({ capacity, byteCapacity, attemptedBytes })),
      )
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  const subscribeClient = (client: Client = { surface: "unknown" }) =>
      Effect.acquireRelease(
        Queue.dropping<Uint8Array, Error>(capacity).pipe(
          Effect.map((queue) => ({
            queue,
            client: { ...client, id: client.id || `anonymous-${++anonymous}` },
            bufferedBytes: 0,
          })),
          Effect.tap((subscriber) => Effect.sync(() => subscribers.set(subscriber.queue, subscriber))),
        ),
        (subscriber) =>
          Effect.sync(() => {
            subscribers.delete(subscriber.queue)
            release(subscriber)
          }).pipe(
            Effect.andThen(Queue.shutdown(subscriber.queue)),
            Effect.asVoid,
          ),
      ).pipe(
        Effect.map((subscriber) =>
          Stream.fromQueue(subscriber.queue).pipe(
            Stream.map((value) => {
              const released = Math.min(subscriber.bufferedBytes, value.byteLength)
              subscriber.bufferedBytes -= released
              metrics.queuedBytes = Math.max(0, metrics.queuedBytes - released)
              return value
            }),
          ),
        ),
      )

  return Service.of({
    subscribe: subscribeClient(),
    subscribeClient,
    diagnostics: Effect.sync(() => {
      const count = Math.min(metrics.frames, FrameSampleCapacity)
      const samples = Array.from(metrics.samples.subarray(0, count)).toSorted((a, b) => a - b)
      const percentile = (value: number) => samples[Math.max(0, Math.ceil(samples.length * value) - 1)] ?? 0
      return {
        subscribers: subscribers.size,
        queuedBytes: metrics.queuedBytes,
        peakQueuedBytes: metrics.peakQueuedBytes,
        frames: metrics.frames,
        encodedBytes: metrics.encodedBytes,
        largestFrameBytes: metrics.largestFrameBytes,
        frameBytesP50: percentile(0.5),
        frameBytesP95: percentile(0.95),
        frameBytesP99: percentile(0.99),
        overflows: metrics.overflows,
      }
    }),
    snapshot: Effect.sync(() => {
      const clients = [
        ...new Map(Array.from(subscribers.values()).map(({ client }) => [client.id, client])).values(),
      ]
      const count = (surface: ClientPresence.Surface) => clients.filter((client) => client.surface === surface).length
      return ClientPresence.Snapshot.make({
        total: clients.length,
        desktop: count("desktop"),
        web: count("web"),
        tui: count("tui"),
        cli: count("cli"),
        api: count("api"),
        automation: count("automation"),
        worker: count("worker"),
        unknown: count("unknown"),
      })
    }),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* make(bus.listen)
  }),
)
