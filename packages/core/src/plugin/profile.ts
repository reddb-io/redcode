export * as PluginProfile from "./profile"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { CordisPluginHost } from "./cordis"

export interface Interface {
  /** Read-only view of the active Cordis profile. Empty until its owner attaches a host. */
  readonly snapshot: Effect.Effect<CordisPluginHost.ProfileSnapshot>
  /**
   * Publishes the reader of the host that owns the active profile. Only the reader is shared:
   * `apply` and `clear` stay with the owning boot, so this service reports composition without
   * becoming the general service locator ADR 0001 forbids.
   */
  readonly attach: (source: Effect.Effect<CordisPluginHost.ProfileSnapshot>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginProfile") {}

export const layer = Layer.sync(Service, () => {
  let source: Effect.Effect<CordisPluginHost.ProfileSnapshot> | undefined
  return Service.of({
    snapshot: Effect.suspend(() => source ?? Effect.succeed({ entries: [] })),
    attach: (input) =>
      Effect.sync(() => {
        source = input
      }),
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })
