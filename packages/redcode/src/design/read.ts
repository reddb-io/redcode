export * as DesignRead from "./read"

import path from "node:path"
import { Effect } from "effect"
import { realpath } from "node:fs/promises"
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
