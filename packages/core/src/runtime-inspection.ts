export * as RuntimeInspection from "./runtime-inspection"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { LayerNode } from "./effect/layer-node"
import { RuntimeInvariant } from "./invariant"
import { PluginProfile } from "./plugin/profile"

export interface Profile {
  readonly name?: string
  readonly plugins: readonly string[]
}

export interface Payload {
  readonly profile: Profile
  readonly services: readonly LayerNode.InspectionEntry[]
  readonly invariants: readonly RuntimeInvariant.Result[]
}

export interface Interface {
  readonly inspect: Effect.Effect<Payload>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RuntimeInspection") {}

/**
 * Read-only view of the composition a Location actually booted: the active Cordis profile,
 * the effective service topology, and the invariant report from boot readiness.
 *
 * `services` is supplied by the module that owns the Location graph so this module never
 * imports that graph back. Every field is an identifier — plugin IDs, service names, tags,
 * dependency names, invariant owners. Config values, credentials, paths, and environment
 * never enter the payload, so it stays safe to print.
 */
export function makeNode(services: () => readonly LayerNode.InspectionEntry[]) {
  return makeLocationNode({
    service: Service,
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const profile = yield* PluginProfile.Service
        const invariants = yield* RuntimeInvariant.Service
        return Service.of({
          inspect: Effect.gen(function* () {
            const snapshot = yield* profile.snapshot
            return {
              profile: { name: snapshot.name, plugins: snapshot.entries },
              services: services(),
              invariants: yield* invariants.results,
            }
          }),
        })
      }),
    ),
    deps: [PluginProfile.node, RuntimeInvariant.node],
  })
}
