import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "../plugin/host"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Catalog.node, Integration.node, EventV2.node]), [
    [
      Location.node,
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) }))),
    ],
  ]),
)

const providerID = ProviderV2.ID.make("minimax")
const modelID = ModelV2.ID.make("MiniMax-M2")

// The models.dev entry for minimax: an Anthropic-protocol SDK bound to an Anthropic-protocol host.
const catalogData = {
  minimax: {
    id: "minimax",
    name: "MiniMax",
    env: ["MINIMAX_API_KEY"],
    npm: "@ai-sdk/anthropic",
    api: "https://api.minimax.io/anthropic/v1",
    models: {
      "MiniMax-M2": {
        id: "MiniMax-M2",
        name: "MiniMax M2",
        release_date: "2025-10-01",
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 200_000, output: 128_000 },
      },
    },
  },
} satisfies Record<string, ModelsDev.Provider>

const decode = Schema.decodeUnknownSync(Config.Info)

const resolve = Effect.fn(function* (info: unknown) {
  const catalog = yield* Catalog.Service
  const integrations = yield* Integration.Service
  const context = host({ catalog: catalogHost(catalog), integration: integrationHost(integrations) })
  yield* ModelsDevPlugin.effect(context).pipe(
    Effect.provideService(
      ModelsDev.Service,
      ModelsDev.Service.of({ get: () => Effect.succeed(catalogData), refresh: () => Effect.void }),
    ),
  )
  yield* ConfigProviderPlugin.Plugin.effect(context).pipe(
    Effect.provideService(
      Config.Service,
      Config.Service.of({
        entries: () => Effect.succeed([new Config.Document({ type: "document", info: decode(info) })]),
      }),
    ),
  )
  return yield* catalog.model.get(providerID, modelID)
})

describe("ConfigProviderPlugin npm coherence", () => {
  it.effect("rejects a provider block whose npm disagrees with the catalog package", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({
        providers: {
          minimax: {
            npm: "@ai-sdk/openai-compatible",
            request: { body: { baseURL: "https://api.minimax.chat/v1" } },
          },
        },
      }).pipe(Effect.exit)

      // Without the check the package stays "@ai-sdk/anthropic" while the url becomes the configured
      // host, so the request goes to https://api.minimax.chat/v1/messages, which exists nowhere.
      expect(Exit.isFailure(exit)).toBe(true)
      const message = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
      expect(message).toContain('Provider "minimax"')
      expect(message).toContain('npm "@ai-sdk/openai-compatible"')
      expect(message).toContain('resolved package is "@ai-sdk/anthropic"')
      expect(message).toContain("https://api.minimax.chat/v1")
      expect(message).toContain("providers.minimax.api")
    }),
  )

  it.effect("rejects the legacy npm and options pair instead of dropping both", () =>
    Effect.gen(function* () {
      const exit = yield* resolve({
        providers: {
          minimax: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://api.minimax.chat/v1" } },
        },
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const message = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
      expect(message).toContain('npm "@ai-sdk/openai-compatible"')
      expect(message).toContain('resolved package is "@ai-sdk/anthropic"')
    }),
  )

  it.effect("accepts npm that agrees with the resolved package", () =>
    Effect.gen(function* () {
      const model = yield* resolve({
        providers: { minimax: { npm: "@ai-sdk/anthropic" } },
      })

      expect(model?.api).toMatchObject({
        type: "aisdk",
        package: "@ai-sdk/anthropic",
        url: "https://api.minimax.io/anthropic/v1",
      })
    }),
  )

  it.effect("keeps retargeting the catalog package at another host when npm is absent", () =>
    Effect.gen(function* () {
      const model = yield* resolve({
        providers: { minimax: { request: { body: { baseURL: "https://minimax.internal/anthropic/v1" } } } },
      })

      expect(model?.api).toMatchObject({
        type: "aisdk",
        package: "@ai-sdk/anthropic",
        url: "https://minimax.internal/anthropic/v1",
      })
    }),
  )
})
