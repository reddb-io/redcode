export * as OperationHookBridge from "./operation-hook-bridge"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { OperationHook } from "@opencode-ai/core/operation-hook"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "./effect/instance-state"

export interface Interface {
  readonly waterfall: OperationHook.Interface["waterfall"]
  readonly serial: OperationHook.Interface["serial"]
  readonly parallel: OperationHook.Interface["parallel"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OperationHookBridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    const route = <A>(effect: Effect.Effect<A, never, OperationHook.Service>) =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        const workspaceID = yield* InstanceState.workspaceID
        return yield* effect.pipe(
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
      })

    return Service.of({
      waterfall: (definition, data) =>
        route(OperationHook.Service.use((hooks) => hooks.waterfall(definition, data))),
      serial: (definition, data) => route(OperationHook.Service.use((hooks) => hooks.serial(definition, data))),
      parallel: (definition, data) => route(OperationHook.Service.use((hooks) => hooks.parallel(definition, data))),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [LocationServiceMap.node] })

export const passthroughLayer = Layer.succeed(
  Service,
  Service.of({
    waterfall: (_definition, data) => Effect.succeed(data),
    serial: () => Effect.void,
    parallel: () => Effect.void,
  }),
)
