import { Cause, Duration, Effect, Exit, ScopedCache, Scope } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"
import { WorkspaceContext } from "@/control-plane/workspace-context"

const TypeId = "~redcode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const context = Effect.gen(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) return yield* Effect.die(new Error("InstanceRef not provided"))
  return ctx
})

export const workspaceID = Effect.gen(function* () {
  return (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
})

export const directory = Effect.map(context, (ctx) => ctx.directory)

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const cache = yield* ScopedCache.makeWith<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          return yield* init(yield* context)
        }),
      // ScopedCache runs the lookup on the fiber of the first caller. When that caller is an
      // HTTP request the client cancels, the lookup exits interrupted and, with the default
      // infinite TTL, every later caller would replay that interruption (HTTP 499) until the
      // instance is disposed. An interrupted lookup is not a result: expire it immediately.
      // A failed init (a config read that hit a transient error) is kept briefly rather than until
      // dispose, so the next requests after a short pause try again instead of failing forever.
      timeToLive: (exit) => {
        if (Exit.isSuccess(exit)) return Duration.infinity
        if (Cause.hasInterruptsOnly(exit.cause)) return Duration.zero
        return FAILED_LOOKUP_TTL
      },
    })

    const off = registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))
    yield* Effect.addFinalizer(() => Effect.sync(off))

    return {
      [TypeId]: TypeId,
      cache,
    }
  })

// Callers that were waiting on a lookup whose first caller was cancelled see that caller's
// interruption. They were not cancelled themselves, so run the lookup again (bounded, in case
// the interruption comes from the cache itself being closed).
const INTERRUPTED_LOOKUP_RETRIES = 3
const FAILED_LOOKUP_TTL = Duration.seconds(5)

export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    const key = yield* directory
    for (let attempt = 0; ; attempt++) {
      const exit = yield* Effect.exit(ScopedCache.get(self.cache, key))
      if (Exit.isSuccess(exit)) return exit.value
      if (attempt >= INTERRUPTED_LOOKUP_RETRIES || !Cause.hasInterruptsOnly(exit.cause)) return yield* exit
      // Retry only an interruption that belonged to another caller. When this fiber is the one
      // being interrupted, end here: by interruptor id when it is known, and otherwise at the
      // interruption point below.
      const fiberId = yield* Effect.fiberId
      if (Cause.interruptors(exit.cause).has(fiberId)) return yield* exit
      yield* Effect.yieldNow
    }
  })

export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select)

export const useEffect = <A, E, R, B, E2, R2>(
  self: InstanceState<A, E, R>,
  select: (value: A) => Effect.Effect<B, E2, R2>,
) => Effect.flatMap(get(self), select)

export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.has(self.cache, yield* directory)
  })

export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.invalidate(self.cache, yield* directory)
  })

export * as InstanceState from "./instance-state"
