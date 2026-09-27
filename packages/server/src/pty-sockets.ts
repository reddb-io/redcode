export * as PtySockets from "./pty-sockets"

import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly register: (close: Effect.Effect<void>) => Effect.Effect<() => void>
  readonly shutdown: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/PtySockets") {}

export const make = Effect.sync(() => {
  const state = { stopping: false, active: new Set<Effect.Effect<void>>() }
  return Service.of({
    register: (close) =>
      Effect.sync(() => {
        if (state.stopping) return false
        state.active.add(close)
        return true
      }).pipe(
        Effect.flatMap((registered) =>
          registered
            ? Effect.succeed(() => state.active.delete(close))
            : Effect.forkDetach(close).pipe(Effect.as(() => {})),
        ),
      ),
    shutdown: Effect.sync(() => {
      state.stopping = true
      return Array.from(state.active)
    }).pipe(
      Effect.flatMap((active) =>
        Effect.forEach(active, (close) => close.pipe(Effect.timeout("1 second"), Effect.ignore), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    ),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(make, (sockets) => sockets.shutdown),
)
