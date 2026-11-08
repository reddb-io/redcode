export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096
export const SubscriberByteCapacity = 4 * 1024 * 1024

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

export interface Interface {
  /** Backward-compatible anonymous event subscription. */
  readonly subscribe: Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
  readonly subscribeClient: (client: Client) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
  readonly snapshot: Effect.Effect<ClientPresence.Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: {
    readonly capacity?: number
    readonly byteCapacity?: number
    readonly encode?: (event: OpenCodeEvent) => string
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const byteCapacity = options?.byteCapacity ?? SubscriberByteCapacity
  const render = options?.encode ?? frame
  type Subscriber = {
    readonly queue: Queue.Queue<string, Error>
    readonly client: Client & { readonly id: string }
    bufferedBytes: number
  }
  const subscribers = new Map<Queue.Queue<string, Error>, Subscriber>()
  let anonymous = 0

  // JavaScript stores strings as one or two bytes per code unit. Counting two
  // gives each slow client a conservative, deterministic memory budget without
  // allocating another encoded copy just to measure it.
  const retainedBytes = (value: string) => value.length * 2

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.values())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber.queue, Cause.fail(error))
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
    const bytes = retainedBytes(encoded)
    for (const [queue, subscriber] of subscribers) {
      const attemptedBytes = subscriber.bufferedBytes + bytes
      if (attemptedBytes <= byteCapacity && Queue.offerUnsafe(queue, encoded)) {
        subscriber.bufferedBytes = attemptedBytes
        continue
      }
      subscribers.delete(queue)
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
        Queue.dropping<string, Error>(capacity).pipe(
          Effect.map((queue) => ({
            queue,
            client: { ...client, id: client.id || `anonymous-${++anonymous}` },
            bufferedBytes: 0,
          })),
          Effect.tap((subscriber) => Effect.sync(() => subscribers.set(subscriber.queue, subscriber))),
        ),
        (subscriber) =>
          Effect.sync(() => subscribers.delete(subscriber.queue)).pipe(
            Effect.andThen(Queue.shutdown(subscriber.queue)),
            Effect.asVoid,
          ),
      ).pipe(
        Effect.map((subscriber) =>
          Stream.fromQueue(subscriber.queue).pipe(
            Stream.map((value) => {
              subscriber.bufferedBytes = Math.max(0, subscriber.bufferedBytes - retainedBytes(value))
              return value
            }),
          ),
        ),
      )

  return Service.of({
    subscribe: subscribeClient(),
    subscribeClient,
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
