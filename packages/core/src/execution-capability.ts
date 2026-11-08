export * as ExecutionCapability from "./execution-capability.js"

import { Context, Effect, Layer, Scope } from "effect"
import { ExecutionCapability } from "@opencode/schema/execution-capability"
import { makeLocationNode } from "@opencode/util/effect/app-node"

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<ExecutionCapability.Info>>
  readonly lease: (capability: ExecutionCapability.Info) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ExecutionCapability") {}

export function make(): Interface {
  const entries = new Map<ExecutionCapability.ID, { capability: ExecutionCapability.Info; owner: object }>()
  return {
    list: () =>
      Effect.sync(() =>
        Array.from(entries.values(), (entry) => entry.capability).toSorted((left, right) =>
          left.id.localeCompare(right.id),
        ),
      ),
    lease: (capability) => {
      const owner = {}
      return Effect.acquireRelease(
        Effect.sync(() => {
          entries.set(capability.id, { capability, owner })
        }),
        () =>
          Effect.sync(() => {
            if (entries.get(capability.id)?.owner === owner) entries.delete(capability.id)
          }),
      )
    },
  }
}

const layer = Layer.succeed(Service, make())

export const node = makeLocationNode({ service: Service, layer, deps: [] })
