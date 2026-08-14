export * as RuntimeInvariant from "./invariant"

import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "./effect/app-node"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Interface {
  readonly register: (
    owner: string,
    check: () => Effect.Effect<void>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly run: Effect.Effect<void>
  readonly list: Effect.Effect<readonly string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RuntimeInvariant") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const checks = new Map<string, () => Effect.Effect<void>>()
    return Service.of({
      register: Effect.fn("RuntimeInvariant.register")(function* (owner, check) {
        if (checks.has(owner)) return yield* Effect.die(`Runtime invariant already registered for ${owner}`)
        checks.set(owner, check)
        let active = true
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          checks.delete(owner)
        })
        yield* Effect.addFinalizer(() => dispose)
        return { dispose }
      }),
      run: Effect.forEach(checks, ([, check]) => check(), { discard: true }),
      list: Effect.sync(() => Array.from(checks.keys())),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
