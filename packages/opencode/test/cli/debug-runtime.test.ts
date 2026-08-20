import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { RuntimeInspection } from "@opencode-ai/core/runtime-inspection"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { renderRuntimeInspection } from "@/cli/cmd/debug/runtime"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const secret = "debug-runtime-secret-username"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ApplicationTools.node, Database.node, EventV2.node, LocationServiceMap.node])),
)

describe("debug runtime", () => {
  it.live("renders the booted composition and no configuration", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir({ config: { username: secret } })),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const config = yield* Config.Service
          const inspection = yield* RuntimeInspection.Service
          const output = renderRuntimeInspection(yield* inspection.inspect)

          // The secret really is loaded configuration for this location, so its absence
          // from the output below is redaction rather than an empty fixture.
          expect(Config.latest(yield* config.entries(), "username")).toBe(secret)

          expect(output).toContain("profile: internal")
          expect(output).toContain("@opencode/v2/RuntimeInspection")
          expect(output).toContain("@opencode-ai/core/plugin: ok")

          // Redaction is a property of the payload, not of the renderer: the configured
          // username and the location directory must never reach the printed output.
          expect(output).not.toContain(secret)
          expect(output).not.toContain(dir.path)
        }).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))),
        ),
      ),
    ),
  )
})
