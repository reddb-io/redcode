export * as HookV2Bridge from "./hook-v2-bridge"

import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { HookV2 } from "@reddb-io/redcode-core/hook"
import { Location } from "@reddb-io/redcode-core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@reddb-io/redcode-core/location-services"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "./effect/instance-state"

export interface Interface {
  /** Runs a declarative hook event in the current instance's Location, as the V2 runtime does. */
  readonly run: HookV2.Interface["run"]
}

export class Service extends Context.Service<Service, Interface>()("@redcode/HookV2Bridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return Service.of({
      run: (input) =>
        Effect.gen(function* () {
          const context = yield* InstanceState.context
          const workspaceID = yield* InstanceState.workspaceID
          return yield* HookV2.Service.use((hooks) => hooks.run(input)).pipe(
            Effect.provide(
              locations.get(
                Location.Ref.make({
                  directory: AbsolutePath.make(context.directory),
                  ...(workspaceID ? { workspaceID } : {}),
                }),
              ),
            ),
            Effect.orDie,
          )
        }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({ service: Service, layer, deps: [locationServiceMapNode] })
