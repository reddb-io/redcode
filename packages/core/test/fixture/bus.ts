import { Effect, Stream } from "effect"
import type { Bus } from "@opencode/core/bus"
import path from "node:path"

/** Live watcher for tests that deliberately provide a stream-only bus. */
export const watchFrom = (subscribe: Bus.Subscribe): Bus.Interface["watch"] =>
  (_id, definitions, handle, options) => Effect.succeed(
    Stream.mergeAll(definitions.map((definition) =>
      subscribe(definition).pipe(Stream.filter((event) => event.type === definition.type)),
    ), { concurrency: "unbounded" }).pipe(
      Stream.filter((event) => {
        const filter = options?.filter
        if (!filter || event.type !== filter.type) return true
        if (typeof event.data !== "object" || event.data === null || !Object.hasOwn(event.data, filter.field)) return false
        const value = (event.data as Record<string, unknown>)[filter.field]
        return typeof value === "string" && (filter.projection === "basename" ? path.basename(value) : value) === filter.value
      }),
      Stream.runForEach((event) => handle(event as never)),
    ),
  )

export const watchBatchFrom = (subscribe: Bus.Subscribe): Bus.Interface["watchBatch"] =>
  (_id, definitions, onPending, handle) => Effect.succeed(
    Stream.mergeAll(definitions.map((definition) =>
      subscribe(definition).pipe(Stream.filter((event) => event.type === definition.type)),
    ), { concurrency: "unbounded" }).pipe(
      Stream.tap(() => onPending),
      Stream.debounce("100 millis"),
      Stream.runForEach((event) => handle([event as never])),
    ),
  )
