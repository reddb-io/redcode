export * as OperationHook from "./operation-hook"

import {
  Definition,
  Operation,
  type Data,
  type Hooks,
  type Observer,
  type ParallelDefinition,
  type Payload,
  type SerialDefinition,
  type WaterfallDefinition,
  type WaterfallHandler,
} from "@reddb-io/redcode-plugin/v2/effect/operation-hook"
import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { EventV2 } from "./event"
import { Location } from "./location"

export { Definition, Operation }

export interface Interface {
  readonly register: Hooks
  readonly waterfall: <D extends WaterfallDefinition>(definition: D, data: Data<D>) => Effect.Effect<Data<D>>
  readonly serial: <D extends SerialDefinition>(definition: D, data: Data<D>) => Effect.Effect<void>
  readonly parallel: <D extends ParallelDefinition>(definition: D, data: Data<D>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/OperationHook") {}

type InternalPayload = {
  readonly id: string
  readonly type: string
  readonly location: Location.Ref
  readonly data: unknown
}

type WaterfallEntry = {
  readonly run: (event: InternalPayload, next: (data?: unknown) => Effect.Effect<unknown>) => Effect.Effect<unknown>
}

type ObserverEntry = {
  readonly run: (event: InternalPayload) => Effect.Effect<void>
}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const waterfallEntries = new Map<string, WaterfallEntry[]>()
    const serialEntries = new Map<string, ObserverEntry[]>()
    const parallelEntries = new Map<string, ObserverEntry[]>()

    const add = <Entry>(entries: Map<string, Entry[]>, type: string, entry: Entry) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        let active = true
        const dispose = Effect.uninterruptible(
          Effect.sync(() => {
            if (!active) return
            active = false
            entries.set(type, (entries.get(type) ?? []).filter((item) => item !== entry))
            if (entries.get(type)?.length === 0) entries.delete(type)
          }),
        )

        yield* Effect.uninterruptible(
          Effect.sync(() => entries.set(type, [...(entries.get(type) ?? []), entry])).pipe(
            Effect.andThen(Scope.addFinalizer(scope, dispose)),
          ),
        )
        return { dispose }
      })

    const waterfall = <D extends WaterfallDefinition>(definition: D, data: Data<D>) =>
      Effect.gen(function* () {
        requireMode(definition, "waterfall")
        const entries = [...(waterfallEntries.get(definition.type) ?? [])]
        const base = {
          id: EventV2.ID.create(),
          type: definition.type,
          location,
        }
        const run = (index: number, current: unknown): Effect.Effect<unknown> => {
          const entry = entries[index]
          if (!entry) return Effect.succeed(current)
          return entry.run({ ...base, data: current }, (next = current) => run(index + 1, next))
        }
        return (yield* run(0, data)) as Data<D>
      })

    const observe = (event: InternalPayload, entry: ObserverEntry) =>
      entry.run(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Operation hook failed", { eventID: event.id, eventType: event.type, cause }),
        ),
      )

    const dispatchObservers = <D extends SerialDefinition | ParallelDefinition>(
      mode: "serial" | "parallel",
      entries: Map<string, ObserverEntry[]>,
      definition: D,
      data: Data<D>,
    ) =>
      Effect.gen(function* () {
        requireMode(definition, mode)
        const event = {
          id: EventV2.ID.create(),
          type: definition.type,
          location,
          data,
        }
        yield* Effect.forEach(entries.get(definition.type) ?? [], (entry) => observe(event, entry), {
          concurrency: mode === "parallel" ? "unbounded" : 1,
          discard: true,
        })
      })

    const registerWaterfall = <D extends WaterfallDefinition>(definition: D, callback: WaterfallHandler<D>) => {
      requireMode(definition, "waterfall")
      const entry: WaterfallEntry = {
        run(event, next) {
          if (event.type !== definition.type) return Effect.die(new Error(`Operation hook type mismatch`))
          const payload = { ...event, type: definition.type, data: event.data as Data<D> } satisfies Payload<D>
          return Effect.suspend(() => {
            const result = callback(payload, (data) => next(data).pipe(Effect.map((value) => value as Data<D>)))
            return Effect.isEffect(result) ? result : Effect.succeed(result)
          })
        },
      }
      return add(waterfallEntries, definition.type, entry)
    }

    const registerObserver = <D extends SerialDefinition | ParallelDefinition>(
      mode: "serial" | "parallel",
      entries: Map<string, ObserverEntry[]>,
      definition: D,
      callback: Observer<D>,
    ) => {
      requireMode(definition, mode)
      const entry: ObserverEntry = {
        run(event) {
          if (event.type !== definition.type) return Effect.die(new Error(`Operation hook type mismatch`))
          const payload = { ...event, type: definition.type, data: event.data as Data<D> } satisfies Payload<D>
          return Effect.suspend(() => {
            const result = callback(payload)
            return Effect.isEffect(result) ? result : Effect.void
          })
        },
      }
      return add(entries, definition.type, entry)
    }

    return Service.of({
      register: {
        waterfall: registerWaterfall,
        serial: (definition, callback) => registerObserver("serial", serialEntries, definition, callback),
        parallel: (definition, callback) => registerObserver("parallel", parallelEntries, definition, callback),
      },
      waterfall,
      serial: (definition, data) => dispatchObservers("serial", serialEntries, definition, data),
      parallel: (definition, data) => dispatchObservers("parallel", parallelEntries, definition, data),
    })
  }),
)

function requireMode(definition: Definition, mode: Definition["mode"]) {
  if (definition.mode !== mode) {
    throw new Error(`Operation hook ${definition.type} uses ${definition.mode}, not ${mode}`)
  }
}

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [Location.node] })
