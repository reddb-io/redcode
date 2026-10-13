import { Reporter } from "@opencode/core/usage/reporter"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Harnesses } from "./harness"

export class HarnessUsage extends Context.Service<HarnessUsage, object>()("@redcode/HarnessUsage") {}
const layer = Layer.effect(
  HarnessUsage,
  Effect.gen(function* () {
    const harness = yield* Harnesses.Service
    const reporter = yield* Reporter.Service
    const drain = Effect.gen(function* () {
      const config = yield* reporter.configuration()
      if (!config.enabled) return
      for (const metric of harness.metrics()) {
        if (
          metric.completedAt !== null &&
          metric.completedAt >= config.since &&
          !(yield* reporter.record({ ...metric, instanceID: config.instanceID }))
        )
          break
        harness.acknowledgeMetric(metric.id)
      }
    }).pipe(Effect.catchCause(() => Effect.logWarning("Harness usage reporting failed")))
    yield* drain.pipe(
      Effect.andThen(Effect.sleep("5 seconds")),
      Effect.forever,
      Effect.forkScoped({ startImmediately: true }),
    )
    return {}
  }),
)
export const harnessUsageNode = makeGlobalNode({ service: HarnessUsage, layer, deps: [Harnesses.node, Reporter.node] })
