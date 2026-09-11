export * as SystemContextBuiltIns from "./builtins"

import { RepositoryGuard } from "../repository-guard"
import { makeLocationNode } from "../effect/app-node"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

/** Repository policy, environment facts, and host-local date for one Location, in baseline order. */
export const context = (location: Location.Interface) => {
  const environment = [
    "<env>",
    `  Working directory: ${location.directory}`,
    `  Workspace root folder: ${location.project.directory}`,
    `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    "</env>",
  ].join("\n")
  return SystemContext.combine([
    SystemContext.make({
      key: SystemContext.Key.make("core/repository-policy"),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.sync(RepositoryGuard.instructions),
      baseline: (instructions) => instructions,
      update: (_previous, instructions) => instructions,
    }),
    SystemContext.make({
      key: SystemContext.Key.make("core/environment"),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.succeed(environment),
      baseline: (environment) =>
        ["Here is some useful information about the environment you are running in:", environment].join("\n"),
      update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
    }),
    SystemContext.make({
      key: SystemContext.Key.make("core/date"),
      codec: Schema.toCodecJson(Schema.String),
      load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
      baseline: (date) => `Today's date: ${date}`,
      update: (_previous, date) => `Today's date is now: ${date}`,
    }),
  ])
}

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    yield* registry.register({
      key: SystemContext.Key.make("core/builtins"),
      load: Effect.succeed(context(location)),
    })
  }),
)

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})
