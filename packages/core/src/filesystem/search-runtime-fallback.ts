import { Cause, Effect, Semaphore } from "effect"
import { Service, type Interface } from "./search-contract.js"

/** Switch once after a technical failure, disposing Rust before constructing legacy. */
export function runtimeFallback(runtime: { service: Interface; dispose: Effect.Effect<void> }, legacy: Effect.Effect<Interface>) {
  const lock = Semaphore.makeUnsafe(1)
  let fallback: Interface | undefined
  const switchToLegacy = Effect.gen(function* () {
    if (fallback) return fallback
    yield* runtime.dispose
    yield* Effect.logWarning("native filename search failed; using legacy rollback", { category: "ERR_REDCODE_SEARCH_RUNTIME" })
    fallback = yield* legacy
    return fallback
  }).pipe(lock.withPermits(1), Effect.uninterruptible)
  return Service.of({
    find: (input) => Effect.suspend(() => {
      if (fallback) return fallback.find(input)
      return runtime.service.find(input).pipe(Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
        return switchToLegacy.pipe(Effect.flatMap((service) => service.find(input)))
      }))
    }),
  })
}
