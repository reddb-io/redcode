export * as RuntimeInvariant from "./invariant"

import { Cause, Context, Effect, Exit, Layer, Scope } from "effect"
import { makeLocationNode } from "./effect/app-node"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Result {
  readonly owner: string
  readonly ok: boolean
  readonly error?: string
}

export interface Interface {
  readonly register: (
    owner: string,
    check: () => Effect.Effect<void>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  /**
   * Runs every registered check and reports one result per owner. Every check runs even
   * when an earlier one fails, so the report names all failing owners, and the run still
   * dies afterwards: a broken invariant must fail boot loudly, never degrade to a warning.
   */
  readonly run: Effect.Effect<readonly Result[]>
  /** Results of the most recent `run`, empty until the first run. */
  readonly results: Effect.Effect<readonly Result[]>
  readonly list: Effect.Effect<readonly string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RuntimeInvariant") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const checks = new Map<string, () => Effect.Effect<void>>()
    let results: readonly Result[] = []
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
      run: Effect.gen(function* () {
        results = yield* Effect.forEach(Array.from(checks), ([owner, check]) =>
          check().pipe(
            Effect.exit,
            Effect.map(
              (exit): Result =>
                Exit.isSuccess(exit) ? { owner, ok: true } : { owner, ok: false, error: Cause.pretty(exit.cause) },
            ),
          ),
        )
        const failed = results.filter((result) => !result.ok)
        if (failed.length > 0)
          return yield* Effect.die(
            `Runtime invariants failed: ${failed.map((result) => `${result.owner}: ${result.error}`).join("; ")}`,
          )
        return results
      }),
      results: Effect.sync(() => results),
      list: Effect.sync(() => Array.from(checks.keys())),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
