import { Deferred, Effect, Layer, Context } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import type { ModelV2 } from "@reddb-io/redcode-core/model"
import type { ProviderV2 } from "@reddb-io/redcode-core/provider"
import type { SessionID } from "./schema"

/**
 * The model a person selects for a session while its turn is running. A turn waiting out a
 * provider's retry delay listens here, so a newly selected model takes the request at once instead
 * of after a wait on the model that failed. Process-local, like the drain that listens.
 */

export type Ref = {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
  readonly variant?: string
}

export interface Interface {
  /** The person selected `model` for the session. Whether a waiting turn took it. */
  readonly select: (sessionID: SessionID, model: Ref) => Effect.Effect<boolean>
  /** Completes with the next model selected for the session that `accept` takes. */
  readonly next: (sessionID: SessionID, accept: (model: Ref) => boolean) => Effect.Effect<Ref>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionModelSwitch") {}

type Waiter = { readonly accept: (model: Ref) => boolean; readonly done: Deferred.Deferred<Ref> }

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const waiters = new Map<string, Set<Waiter>>()

    const select = Effect.fn("SessionModelSwitch.select")(function* (sessionID: SessionID, model: Ref) {
      const taken = [...(waiters.get(sessionID) ?? [])].filter((waiter) => waiter.accept(model))
      yield* Effect.forEach(taken, (waiter) => Deferred.succeed(waiter.done, model), { discard: true })
      return taken.length > 0
    })

    const next = (sessionID: SessionID, accept: (model: Ref) => boolean) =>
      Effect.gen(function* () {
        const waiter: Waiter = { accept, done: yield* Deferred.make<Ref>() }
        const set = waiters.get(sessionID) ?? new Set()
        set.add(waiter)
        waiters.set(sessionID, set)
        return yield* Deferred.await(waiter.done).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              set.delete(waiter)
              if (set.size === 0 && waiters.get(sessionID) === set) waiters.delete(sessionID)
            }),
          ),
        )
      })

    return Service.of({ select, next })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as SessionModelSwitch from "./model-switch"
