export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { ClientPresence } from "@opencode/schema/client-presence"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096

export class SubscriberOverflowError extends Schema.TaggedError<SubscriberOverflowError>()(
  "EventFeed.SubscriberOverflow",
  { capacity: Schema.Int },
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
  options?: { readonly capacity?: number; readonly encode?: (event: OpenCodeEvent) => string },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const render = options?.encode ?? frame
  const subscribers = new Map<Queue.Queue<string, Error>, Client & { readonly id: string }>()
  let anonymous = 0

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.keys())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber, Cause.fail(error))
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
    for (const subscriber of subscribers.keys()) {
      if (Queue.offerUnsafe(subscriber, encoded)) continue
      subscribers.delete(subscriber)
      Queue.failCauseUnsafe(subscriber, Cause.fail(new SubscriberOverflowError({ capacity })))
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  const subscribeClient = (client: Client = { surface: "unknown" }) =>
      Effect.acquireRelease(
        Queue.dropping<string, Error>(capacity).pipe(
          Effect.tap((queue) =>
            Effect.sync(() => subscribers.set(queue, { ...client, id: client.id || `anonymous-${++anonymous}` })),
          ),
        ),
        (queue) =>
          Effect.sync(() => subscribers.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
      ).pipe(Effect.map(Stream.fromQueue))

  return Service.of({
    subscribe: subscribeClient(),
    subscribeClient,
    snapshot: Effect.sync(() => {
      const clients = [...new Map(Array.from(subscribers.values()).map((client) => [client.id, client])).values()]
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
