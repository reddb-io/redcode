export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096
export const SubscriberByteCapacity = 4 * 1024 * 1024
export const ReplayCapacity = 4_096
export const ReplayByteCapacity = 4 * 1024 * 1024
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

export type Cursor = { readonly epoch: string; readonly cursor: number }
export type Connection = {
  readonly epoch: string
  readonly cursor: number
  readonly replayed: number
  readonly reset: boolean
  readonly stream: Stream.Stream<Uint8Array, Error>
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
  readonly acknowledgements: number
  readonly replayedFrames: number
  readonly replayMisses: number
  readonly retainedFrames: number
  readonly retainedBytes: number
  readonly cursor: number
  readonly oldestCursor: number
  readonly acknowledgedClients: number
  readonly maxAcknowledgementLag: number
}

export interface Interface {
  /** Backward-compatible anonymous event subscription. */
  readonly subscribe: Effect.Effect<Stream.Stream<Uint8Array, Error>, never, Scope.Scope>
  readonly subscribeClient: (client: Client) => Effect.Effect<Stream.Stream<Uint8Array, Error>, never, Scope.Scope>
  readonly connectClient: (
    client: Client,
    resume?: Cursor,
  ) => Effect.Effect<Connection, never, Scope.Scope>
  readonly acknowledge: (clientID: string | undefined, cursor: Cursor) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ClientPresence.Snapshot>
  readonly diagnostics: Effect.Effect<Diagnostics>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent, id?: string) {
  return `${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(event)}\n\n`
}

export function frameBytes(event: OpenCodeEvent, id?: string) {
  return encoder.encode(frame(event, id))
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: {
    readonly capacity?: number
    readonly byteCapacity?: number
    readonly replayCapacity?: number
    readonly replayByteCapacity?: number
    readonly encode?: (event: OpenCodeEvent, id: string) => Uint8Array
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const byteCapacity = options?.byteCapacity ?? SubscriberByteCapacity
  const replayCapacity = options?.replayCapacity ?? ReplayCapacity
  const replayByteCapacity = options?.replayByteCapacity ?? ReplayByteCapacity
  const render = options?.encode ?? frameBytes
  const epoch = crypto.randomUUID()
  type Retained = { readonly seq: number; readonly bytes: Uint8Array }
  const retained = new Array<Retained | undefined>()
  let retainedHead = 0
  const acknowledgements = new Map<string, Cursor & { readonly at: number }>()
  let sequence = 0
  let retainedBytes = 0
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
    acknowledgements: 0,
    replayedFrames: 0,
    replayMisses: 0,
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
    const seq = ++sequence
    const encoded = yield* Effect.try({
      try: () => render(event, `${epoch}:${seq}`),
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
    retained.push({ seq, bytes: encoded })
    retainedBytes += bytes
    while (retained.length - retainedHead > replayCapacity || retainedBytes > replayByteCapacity) {
      const removed = retained[retainedHead]
      if (!removed) break
      retained[retainedHead] = undefined
      retainedHead += 1
      retainedBytes = Math.max(0, retainedBytes - removed.bytes.byteLength)
    }
    // Compact infrequently so steady high-volume streams do not shift thousands of references per event.
    if (retainedHead >= 1_024 && retainedHead * 2 >= retained.length) {
      retained.splice(0, retainedHead)
      retainedHead = 0
    }
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

  const connectClient = (client: Client = { surface: "unknown" }, resume?: Cursor) =>
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
        Effect.map((subscriber) => {
          const through = sequence
          const oldest = retained[retainedHead]?.seq ?? through + 1
          const valid =
            resume !== undefined &&
            resume.epoch === epoch &&
            resume.cursor >= oldest - 1 &&
            resume.cursor <= through
          const replay = valid
            ? retained
                .slice(retainedHead)
                .flatMap((item) => (item && item.seq > resume.cursor && item.seq <= through ? [item] : []))
            : []
          const reset = resume !== undefined && !valid
          if (reset) metrics.replayMisses += 1
          if (replay.length) {
            metrics.replayedFrames += replay.length
          }
          const live = Stream.fromQueue(subscriber.queue).pipe(
            Stream.map((value) => {
              const released = Math.min(subscriber.bufferedBytes, value.byteLength)
              subscriber.bufferedBytes -= released
              metrics.queuedBytes = Math.max(0, metrics.queuedBytes - released)
              return value
            }),
          )
          return {
            epoch,
            cursor: through,
            replayed: replay.length,
            reset,
            stream: Stream.fromIterable(replay.map((item) => item.bytes)).pipe(Stream.concat(live)),
          }
        }),
      )

  const subscribeClient = (client: Client = { surface: "unknown" }) =>
    connectClient(client).pipe(Effect.map((connection) => connection.stream))

  return Service.of({
    subscribe: subscribeClient(),
    subscribeClient,
    connectClient,
    acknowledge: (clientID, cursor) =>
      Effect.sync(() => {
        if (!clientID || cursor.epoch !== epoch || cursor.cursor < 0 || cursor.cursor > sequence) return
        const current = acknowledgements.get(clientID)
        if (current?.epoch === cursor.epoch && current.cursor >= cursor.cursor) return
        acknowledgements.set(clientID, { ...cursor, at: Date.now() })
        while (acknowledgements.size > ReplayCapacity) {
          const oldest = acknowledgements.keys().next().value
          if (oldest === undefined) break
          acknowledgements.delete(oldest)
        }
        metrics.acknowledgements += 1
      }),
    diagnostics: Effect.sync(() => {
      const count = Math.min(metrics.frames, FrameSampleCapacity)
      const samples = Array.from(metrics.samples.subarray(0, count)).toSorted((a, b) => a - b)
      const percentile = (value: number) => samples[Math.max(0, Math.ceil(samples.length * value) - 1)] ?? 0
      const activeClientIDs = new Set(Array.from(subscribers.values(), (subscriber) => subscriber.client.id))
      const activeAcknowledgements = Array.from(acknowledgements, ([clientID, value]) =>
        activeClientIDs.has(clientID) ? value : undefined,
      ).filter((value): value is Cursor & { readonly at: number } => value !== undefined)
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
        acknowledgements: metrics.acknowledgements,
        replayedFrames: metrics.replayedFrames,
        replayMisses: metrics.replayMisses,
        retainedFrames: retained.length - retainedHead,
        retainedBytes,
        cursor: sequence,
        oldestCursor: retained[retainedHead]?.seq ?? sequence,
        acknowledgedClients: activeAcknowledgements.length,
        maxAcknowledgementLag: Math.max(
          0,
          ...activeAcknowledgements.map((value) => sequence - value.cursor),
        ),
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
