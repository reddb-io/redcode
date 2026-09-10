export * as MonitorRuntime from "./monitor"

import { Monitor } from "@reddb-io/redcode-core/monitor"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { BackgroundJob } from "./job"
import { Effect, Layer } from "effect"

export { Service } from "@reddb-io/redcode-core/monitor"

const layer = Layer.effect(
  Monitor.Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const background = yield* BackgroundJob.Service
    const state = yield* InstanceState.make(() =>
      Monitor.make.pipe(
        Effect.provideService(Database.Service, database),
        Effect.provideService(BackgroundJob.Service, background),
      ),
    )
    return Monitor.Service.of({
      start: (input) => InstanceState.useEffect(state, (service) => service.start(input)),
      get: (sessionID, id) => InstanceState.useEffect(state, (service) => service.get(sessionID, id)),
      list: (sessionID) => InstanceState.useEffect(state, (service) => service.list(sessionID)),
      wait: (sessionID, id, timeout) =>
        InstanceState.useEffect(state, (service) => service.wait(sessionID, id, timeout)),
      cancel: (sessionID, id) => InstanceState.useEffect(state, (service) => service.cancel(sessionID, id)),
    })
  }),
)

export const node = LayerNode.make({ service: Monitor.Service, layer, deps: [Database.node, BackgroundJob.node] })
