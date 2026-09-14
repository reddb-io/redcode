export * as DesignRead from "./read"

import path from "node:path"
import { Effect } from "effect"
import { realpath, stat } from "node:fs/promises"
import type { Design } from "@reddb-io/redcode-schema/design"
import { DesignBuild } from "@reddb-io/redcode-core/design/build"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import type { Tool } from "@/tool/tool"

export const make = Effect.fn("DesignRead.make")(function* (ask: Tool.Context["ask"]) {
  const bridge = yield* EffectBridge.make()
  const instance = yield* InstanceState.context
  return (file: string, signal?: AbortSignal) =>
    Effect.runPromise(
      bridge.run(
        Effect.gen(function* () {
          const resolved = yield* Effect.promise(() => realpath(file))
          if (!FSUtil.contains(instance.directory, resolved))
            yield* ask({
              permission: "external_directory",
              patterns: [path.join(path.dirname(resolved), "*")],
              always: [path.join(path.dirname(resolved), "*")],
              metadata: { path: resolved },
            })
          yield* ask({ permission: "read", patterns: [resolved], always: [resolved], metadata: { path: resolved } })
        }),
      ),
      { signal },
    )
})

/** Declared design-system roots are one standing read grant per design instead of a prompt per imported file. */
export const grant = Effect.fn("DesignRead.grant")(function* (document: Design.Info, ask: Tool.Context["ask"]) {
  const instance = yield* InstanceState.context
  const paths = yield* Effect.promise(() => DesignBuild.grant(document))
  if (!paths.length) return
  const patterns = yield* Effect.promise(() =>
    Promise.all(paths.map(async (file) => ((await stat(file)).isDirectory() ? path.join(file, "*") : file))),
  )
  const metadata = {
    origin: "design.system",
    reason:
      "Standing read grant for design builds: every preview of this design imports the declared design-system roots, stylesheets, tooling configuration and node_modules without further prompts.",
  }
  const external = [
    ...new Set(
      paths.flatMap((file, index) =>
        FSUtil.contains(instance.directory, file)
          ? []
          : [patterns[index].endsWith("*") ? patterns[index] : path.join(path.dirname(file), "*")],
      ),
    ),
  ]
  if (external.length) yield* ask({ permission: "external_directory", patterns: external, always: external, metadata })
  yield* ask({ permission: "read", patterns, always: patterns, metadata })
})
