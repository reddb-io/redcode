import { describe, expect } from "bun:test"
import { Money } from "@opencode/schema/money"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Effect, Schedule, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ModelsDev } from "@opencode/core/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { catalogLimits, knownLimit, undescribedLimit } from "@opencode/core/plugin/provider/catalog-limits"
import { AzurePlugin } from "@opencode/core/plugin/provider/azure"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { XAIPlugin } from "@opencode/core/plugin/provider/xai"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const decode = Schema.decodeUnknownSync(Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("applies migrated release date and status to the model catalog", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: { custom: { models: { chat: { release_date: "2025-04-10", status: "beta" } } } },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      const model = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("chat")))
      expect(model.time.released).toBe(Date.parse("2025-04-10"))
      expect(model.status).toBe("beta")
    }),
  )

  it.effect("removes variants disabled by migrated V1 model configuration", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      yield* providers.transform((editor) =>
        editor.models.update(providerID, modelID, (model) => {
          model.variants = [
            { id: Model.VariantID.make("low") },
            { id: Model.VariantID.make("high") },
          ]
        }),
      )
      const migrated = ConfigNormalize.normalize({
        provider: { custom: { models: { chat: { variants: { high: { disabled: true } } } } } },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      expect(migrated.diagnostics).toEqual([])
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(providerID, modelID))?.variants.map((variant) => variant.id)).toEqual([Model.VariantID.make("low")])
    }),
  )

  it.effect("preserves catalog modalities when V1 overrides only attachment and temperature", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      yield* providers.transform((editor) =>
        editor.models.update(providerID, Model.ID.make("chat"), (model) => {
          model.capabilities = { tools: true, temperature: true, input: ["text", "image", "pdf"], output: ["text"] }
        }),
      )
      const migrated = ConfigNormalize.normalize({
        provider: { custom: { models: { chat: { attachment: false, temperature: false } } } },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(providerID, Model.ID.make("chat")))?.capabilities).toEqual({
        tools: true,
        temperature: false,
        input: ["text", "pdf"],
        output: ["text"],
      })
    }),
  )

  it.effect("keeps authored variants when V1 disables catalog reasoning", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      yield* providers.transform((editor) =>
        editor.models.update(providerID, modelID, (model) => {
          model.capabilities = { ...model.capabilities, reasoning: true }
          model.variants = [
            { id: Model.VariantID.make("low") },
            { id: Model.VariantID.make("high") },
            { id: Model.VariantID.make("fast") },
          ]
          model.reasoningVariantIDs = [Model.VariantID.make("low"), Model.VariantID.make("high")]
        }),
      )
      const migrated = ConfigNormalize.normalize({
        provider: { custom: { models: { chat: { reasoning: false, variants: { high: {} } } } } },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      const model = required(yield* models.get(providerID, modelID))
      expect(model.capabilities.reasoning).toBe(false)
      expect(model.variants.map((variant) => variant.id)).toEqual([Model.VariantID.make("high"), Model.VariantID.make("fast")])
      expect(model.reasoningVariantIDs).toEqual([Model.VariantID.make("high")])
    }),
  )

  it.effect("adds reasoning variants beside unrelated modes when V1 enables reasoning", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      yield* providers.transform((editor) => {
        editor.update(providerID, (provider) => {
          provider.package = "@opencode/ai/providers/openai-compatible"
        })
        editor.models.update(providerID, modelID, (model) => {
          model.capabilities = { ...model.capabilities, reasoning: false }
          model.variants = [{ id: Model.VariantID.make("fast") }]
        })
      })
      const migrated = ConfigNormalize.normalize({ provider: { custom: { models: { chat: { reasoning: true } } } } })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      const model = required(yield* models.get(providerID, modelID))
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.variants.map((variant) => variant.id)).toEqual(["fast", "low", "medium", "high"].map((id) => Model.VariantID.make(id)))
      expect(model.reasoningVariantIDs).toEqual(["low", "medium", "high"].map((id) => Model.VariantID.make(id)))
    }),
  )

  it.effect("applies V1 Gemini reasoning defaults while preserving explicit model options", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          google: {
            npm: "@ai-sdk/google",
            models: {
              "gemini-3-pro": { reasoning: true },
              "gemini-3-flash": {
                reasoning: true,
                options: { thinkingConfig: { includeThoughts: false, thinkingLevel: "low" } },
              },
            },
          },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(Provider.ID.make("google"), Model.ID.make("gemini-3-pro")))?.settings?.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingLevel: "high",
      })
      expect((yield* models.get(Provider.ID.make("google"), Model.ID.make("gemini-3-flash")))?.settings?.thinkingConfig).toEqual({
        includeThoughts: false,
        thinkingLevel: "low",
      })
    }),
  )

  it.effect("applies V1 Kimi reasoning defaults on the native Anthropic route", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          moonshotai: {
            npm: "@opencode/ai/providers/moonshot/messages",
            models: { "kimi-k2.5": { reasoning: true, options: { effort: "medium" } } },
          },
          custom: {
            npm: "@opencode/ai/providers/anthropic",
            api: "https://api.moonshot.ai/anthropic",
            models: { chat: { reasoning: true } },
          },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      const settings = (yield* models.get(Provider.ID.make("moonshotai"), Model.ID.make("kimi-k2.5")))?.settings
      expect(settings?.thinking).toEqual({ type: "adaptive", display: "summarized" })
      expect(settings?.effort).toBe("medium")
      expect((yield* models.get(Provider.ID.make("custom"), Model.ID.make("chat")))?.settings).toMatchObject({
        thinking: { type: "adaptive", display: "summarized" },
        effort: "high",
      })
    }),
  )

  it.effect("uses the migrated output limit for V1 Kimi reasoning budgets", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          custom: {
            npm: "@ai-sdk/anthropic",
            models: { "kimi-k2.5": { reasoning: true, limit: { context: 20_000, output: 1_000 } } },
          },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(Provider.ID.make("custom"), Model.ID.make("kimi-k2.5")))?.settings?.thinking).toEqual({
        type: "enabled",
        budgetTokens: 499,
      })
    }),
  )

  it.effect("enables V1 Alibaba reasoning except for kimi-k2-thinking", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          "alibaba-cn": {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "qwen-plus": { reasoning: true },
              "kimi-k2-thinking": { reasoning: true },
              "qwen-no-reasoning": { reasoning: false },
            },
          },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(Provider.ID.make("alibaba-cn"), Model.ID.make("qwen-plus")))?.settings?.enableThinking).toBe(true)
      expect((yield* models.get(Provider.ID.make("alibaba-cn"), Model.ID.make("kimi-k2-thinking")))?.settings?.enableThinking).toBeUndefined()
      expect((yield* models.get(Provider.ID.make("alibaba-cn"), Model.ID.make("qwen-no-reasoning")))?.settings?.enableThinking).toBeUndefined()
    }),
  )

  it.effect("preserves V1 MiniMax, ZAI, and OpenRouter reasoning defaults", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          minimax: {
            npm: "@ai-sdk/anthropic",
            models: { "minimax-m3": { reasoning: true } },
          },
          zai: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "glm-5": { reasoning: true, options: { thinking: { clear_thinking: true } } },
              "glm-4": { reasoning: false },
            },
          },
          openrouter: {
            npm: "@openrouter/ai-sdk-provider",
            models: { "google/gemini-3-pro": { reasoning: true } },
          },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])
      expect((yield* models.get(Provider.ID.make("minimax"), Model.ID.make("minimax-m3")))?.settings?.thinking).toEqual({
        type: "adaptive",
      })
      expect((yield* models.get(Provider.ID.make("zai"), Model.ID.make("glm-5")))?.settings?.thinking).toEqual({
        type: "enabled",
        clear_thinking: true,
      })
      expect((yield* models.get(Provider.ID.make("zai"), Model.ID.make("glm-4")))?.settings?.thinking).toBeUndefined()
      expect((yield* models.get(Provider.ID.make("openrouter"), Model.ID.make("google/gemini-3-pro")))?.settings?.reasoning).toEqual({
        effort: "high",
      })
    }),
  )

  it.effect("preserves V1 GPT reasoning defaults on legacy AI SDK packages", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const migrated = ConfigNormalize.normalize({
        provider: {
          legacyOpenAI: {
            npm: "@ai-sdk/openai",
            models: {
              "gpt-6-sol": { reasoning: true, options: { reasoningEffort: "high" } },
              "gpt-5.2-chat-latest": { reasoning: true },
            },
          },
          legacyAzure: {
            npm: "@ai-sdk/azure",
            options: { useCompletionUrls: true },
            models: { "gpt-5.4": { reasoning: true }, "gpt-6-sol": { reasoning: true } },
          },
          legacyCopilot: { npm: "@ai-sdk/github-copilot", models: { "gpt-6-sol": { reasoning: true } } },
          legacyMantle: { npm: "@ai-sdk/amazon-bedrock/mantle", models: { "gpt-6-sol": { reasoning: true } } },
        },
      })
      if (migrated.type !== "normalized") throw new Error("Expected normalized config")
      yield* addPlugin([new Document({ type: "document", info: decode(migrated.encoded) })])

      expect((yield* models.get(Provider.ID.make("legacyOpenAI"), Model.ID.make("gpt-6-sol")))?.settings).toMatchObject({
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
      expect(
        (yield* models.get(Provider.ID.make("legacyOpenAI"), Model.ID.make("gpt-5.2-chat-latest")))?.settings
          ?.reasoningEffort,
      ).toBeUndefined()
      expect((yield* models.get(Provider.ID.make("legacyAzure"), Model.ID.make("gpt-5.4")))?.settings).toMatchObject({
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      })
      expect((yield* models.get(Provider.ID.make("legacyAzure"), Model.ID.make("gpt-6-sol")))?.settings?.reasoningEffort).toBeUndefined()
      expect((yield* models.get(Provider.ID.make("legacyCopilot"), Model.ID.make("gpt-6-sol")))?.settings).toMatchObject({
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      })
      expect((yield* models.get(Provider.ID.make("legacyMantle"), Model.ID.make("gpt-6-sol")))?.settings).toMatchObject({
        reasoningEffort: "medium",
        include: ["reasoning.encrypted_content"],
      })
    }),
  )

  it.effect("applies variant overrides to generated defaults for new models", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "@opencode/ai/providers/openai",
                models: { chat: { variants: [{ id: "high", disabled: true }] } },
              },
            },
          }),
        }),
      ])
      const variants = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("chat"))).variants
      expect(variants.map((variant) => variant.id)).toContain(Model.VariantID.make("low"))
      expect(variants.map((variant) => variant.id)).not.toContain(Model.VariantID.make("high"))
    }),
  )

  it.effect("filters catalog models by the configured include and exclude lists", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, Model.ID.make("chat"), () => {})
        editor.models.update(providerID, Model.ID.make("legacy"), () => {})
        editor.models.update(providerID, Model.ID.make("other"), () => {})
        editor.models.update(Provider.ID.make("empty"), Model.ID.make("chat"), () => {})
      })
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: { includeModels: ["chat", "legacy"], excludeModels: ["legacy"] },
              empty: { includeModels: [] },
            },
          }),
        }),
      ])
      expect(yield* models.get(providerID, Model.ID.make("chat"))).toBeDefined()
      expect(yield* models.get(providerID, Model.ID.make("legacy"))).toBeUndefined()
      expect(yield* models.get(providerID, Model.ID.make("other"))).toBeUndefined()
      expect(yield* models.get(Provider.ID.make("empty"), Model.ID.make("chat"))).toBeUndefined()
    }),
  )

  it.effect("inherits the provider compaction setting with model overrides and rejects unsupported routes", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "@opencode/ai/providers/openai/responses",
                settings: { compaction: { type: "native" } },
                models: {
                  native: {},
                  local: { settings: { compaction: { type: "summary" } }, package: "@opencode/ai/providers/openai/chat" },
                  unsupported: { package: "@opencode/ai/providers/openai/chat" },
                },
              },
              default: { package: "@opencode/ai/providers/openai/chat", models: { chat: {} } },
            },
          }),
        }),
      ])
      const native = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("native")))
      const local = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("local")))
      const unsupported = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("unsupported")))
      const defaultModel = required(yield* models.get(Provider.ID.make("default"), Model.ID.make("chat")))
      expect(native.settings?.compaction).toEqual({ type: "native" })
      expect(local.settings?.compaction).toEqual({ type: "summary" })
      expect(defaultModel.settings?.compaction).toBeUndefined()
      expect((yield* providers.get(Provider.ID.make("custom")))?.settings?.compaction).toEqual({ type: "native" })
      yield* ModelResolver.fromCatalogModel(native)
      yield* ModelResolver.fromCatalogModel(local)
      yield* ModelResolver.fromCatalogModel(defaultModel)
      expect(yield* ModelResolver.fromCatalogModel(unsupported).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionRunnerModel.UnsupportedCompactionError",
        message: "Provider compaction is not supported by custom/unsupported (openai-chat)",
      })
    }),
  )

  it.effect("keeps the provider websocket policy out of model settings", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "@opencode/ai/providers/openai/responses",
                settings: { transport: "http", timeout: 100, chunkTimeout: 200, shared: "provider" },
                models: {
                  inherited: {
                    settings: { transport: "websocket", timeout: 1, chunkTimeout: 2, model: true },
                  },
                },
              },
              default: { package: "@opencode/ai/providers/openai/responses", models: { untouched: {} } },
            },
          }),
        }),
      ])
      const inherited = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("inherited")))
      const untouched = required(yield* models.get(Provider.ID.make("default"), Model.ID.make("untouched")))
      expect((yield* providers.get(Provider.ID.make("custom")))?.settings?.transport).toBe("http")
      expect(inherited.settings).toEqual({ shared: "provider", model: true })
      expect(untouched.settings?.transport).toBeUndefined()
    }),
  )

  for (const builtin of [
    { id: "openai", model: "gpt-5.6-sol", package: "@opencode/ai/providers/openai/responses", plugin: OpenAIPlugin },
    { id: "xai", model: "grok-4.6", package: "@opencode/ai/providers/xai", plugin: XAIPlugin },
    { id: "azure", model: "gpt-5.6-sol", package: "@opencode/ai/providers/azure/responses", plugin: AzurePlugin },
    { id: "custom-azure", model: "deployment", package: "@opencode/ai/providers/azure/responses", plugin: AzurePlugin },
  ]) {
    it.live(`configured provider transport overrides ${builtin.id} defaults`, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const plugin = yield* Plugin.Service
        const host = yield* PluginHost.make(plugin)
        const providerID = Provider.ID.make(builtin.id)
        const modelID = Model.ID.make(builtin.model)
        yield* providers.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.activation = "enabled"
            provider.package = builtin.package
          })
          editor.models.update(providerID, modelID, () => {})
        })
        yield* builtin.plugin.effect(host)
        expect((yield* providers.get(providerID))?.settings?.transport).toBe("websocket")
        expect((yield* models.get(providerID, modelID))?.settings?.transport).toBeUndefined()

        yield* addPlugin([
          new Document({
            type: "document",
            info: decode({
              providers: {
                [builtin.id]: {
                  settings: { transport: "http" },
                  models: { override: { modelID: builtin.model } },
                },
              },
            }),
          }),
        ])

        expect((yield* providers.get(providerID))?.settings?.transport).toBe("http")
        expect((yield* models.get(providerID, modelID))?.settings?.transport).toBeUndefined()
        expect((yield* models.get(providerID, Model.ID.make("override")))?.settings?.transport).toBeUndefined()
      }),
    )
  }

  it.effect("adds key auth for custom providers without env credentials", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              litellm: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { chat: {} },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect(yield* integrations.get(Integration.ID.make("litellm"))).toMatchObject({
        id: "litellm",
        name: "litellm",
        methods: [{ type: "key", label: "Manually enter API Key" }],
      })
    }),
  )

  it.effect("defaults custom model metadata", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { chat: {} },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* models.get(providerID, modelID))
      expect(model.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
      expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
    }),
  )

  it.effect("resolves a model only the configuration defines from the catalog by id, on every fold", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const modelsDev = yield* ModelsDev.Service
      const providerID = Provider.ID.make("custom")
      const known = required(knownLimit(catalogLimits(yield* modelsDev.get()), "glm-5.3-flash"))
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: {
                  "glm-5.3-flash": {},
                  "GLM-5.3-Flash:free": { limit: { output: 1_000 } },
                  fast: { modelID: "zai-org/GLM-5.3-Flash" },
                  chat: {},
                },
              },
            },
          }),
        }),
      ])
      expect(required(yield* models.get(providerID, Model.ID.make("glm-5.3-flash"))).limit).toEqual(known)
      // What the configuration declares wins over the catalog.
      expect(required(yield* models.get(providerID, Model.ID.make("GLM-5.3-Flash:free"))).limit).toEqual({
        context: known.context,
        output: 1_000,
      })
      // An alias is looked up by the id the endpoint knows it by.
      expect(required(yield* models.get(providerID, Model.ID.make("fast"))).limit.context).toBeGreaterThan(200_000)
      // A model the catalog does not know keeps its defaults off a generic endpoint.
      expect(required(yield* models.get(providerID, Model.ID.make("chat"))).limit).toEqual({
        context: 200_000,
        output: 32_000,
      })
    }),
  )

  it.effect("guesses the limits of a model on a generic endpoint that nothing describes and heals a frozen guess", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const modelsDev = yield* ModelsDev.Service
      const providerID = Provider.ID.make("api-example-com")
      const known = required(knownLimit(catalogLimits(yield* modelsDev.get()), "glm-5.3-flash"))
      const frozen = { context: undescribedLimit.context, output: undescribedLimit.output }
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              "api-example-com": {
                package: "@opencode/ai/providers/openai-compatible",
                settings: { baseURL: "https://api.example.com/v1", provider: "api-example-com" },
                models: {
                  nobody: {},
                  reported: { limit: { context: 64_000, output: 4_000 } },
                  "glm-5.3-flash": { limit: frozen },
                  "mimo-v2.6-pro": { limit: { context: undescribedLimit.context, output: 4_000 } },
                  stale: { limit: frozen },
                  capped: { limit: { context: undescribedLimit.context, output: undescribedLimit.context } },
                  wide: { limit: { context: 4_000 } },
                },
              },
            },
          }),
        }),
      ])
      const limit = (id: string) =>
        models.get(providerID, Model.ID.make(id)).pipe(Effect.map((model) => required(model).limit))
      expect(yield* limit("nobody")).toEqual(frozen)
      expect(yield* limit("reported")).toEqual({ context: 64_000, output: 4_000 })
      // A guess an older version wrote is not a fact: the catalog now knows the model.
      expect(yield* limit("glm-5.3-flash")).toEqual(known)
      // The reported output beside a guessed context is kept.
      expect((yield* limit("mimo-v2.6-pro")).output).toBe(4_000)
      expect((yield* limit("mimo-v2.6-pro")).context).toBeGreaterThan(undescribedLimit.context)
      // A model the catalog still does not know is guessed again, not frozen.
      expect(yield* limit("stale")).toEqual(frozen)
      expect(yield* limit("capped")).toEqual(frozen)
      // The default output never exceeds a declared context.
      expect(yield* limit("wide")).toEqual({ context: 4_000, output: 4_000 })
    }),
  )

  it.effect("completes a declared limit across documents and follows the catalog when it learns a model", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const bus = yield* Bus.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const providerID = Provider.ID.make("local")
      const bundled = yield* ModelsDev.bundled
      const known = required(knownLimit(catalogLimits(bundled), "glm-5.3-flash"))
      const catalog = { data: [] as readonly ModelsDev.Snapshot[] }
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              local: {
                package: "@opencode/ai/providers/openai-compatible",
                settings: { baseURL: "http://127.0.0.1:1234/v1" },
                models: { "glm-5.3-flash": {}, partial: { limit: { context: 50_000 } } },
              },
            },
          }),
        }),
        new Document({
          type: "document",
          info: decode({ providers: { local: { models: { partial: { limit: { output: 1_000 } }, later: {} } } } }),
        }),
      ]
      yield* ConfigProviderPlugin.Plugin.effect(host).pipe(
        Effect.provide(Config.testLayer(entries)),
        Effect.provideService(
          ModelsDev.Service,
          ModelsDev.Service.of({ get: () => Effect.sync(() => catalog.data), refresh: () => Effect.void }),
        ),
      )
      const limit = (id: string) =>
        models.get(providerID, Model.ID.make(id)).pipe(Effect.map((model) => required(model).limit))
      expect(yield* limit("partial")).toEqual({ context: 50_000, output: 1_000 })
      expect(yield* limit("later")).toEqual({ context: undescribedLimit.context, output: undescribedLimit.output })
      // Without a catalog the model is guessed; once the catalog learns it, the next fold uses the real window.
      expect(yield* limit("glm-5.3-flash")).toEqual({
        context: undescribedLimit.context,
        output: undescribedLimit.output,
      })
      catalog.data = bundled
      yield* bus.publish(ModelsDev.Event.Refreshed, {})
      yield* limit("glm-5.3-flash").pipe(
        Effect.filterOrFail((current) => current.context === known.context),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("5 seconds"),
      )
      expect(yield* limit("glm-5.3-flash")).toEqual(known)
      expect(yield* limit("partial")).toEqual({ context: 50_000, output: 1_000 })
    }),
  )

  it.effect("preserves catalog capabilities unless config overrides them", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const inheritedID = Model.ID.make("inherited")
      const overriddenID = Model.ID.make("overridden")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, inheritedID, (model) => {
          model.capabilities = { tools: false, input: ["text"], output: ["text"] }
        })
        editor.models.update(providerID, overriddenID, (model) => {
          model.capabilities = { tools: false, input: ["text"], output: ["text"] }
        })
      })
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: {
                  inherited: { name: "Inherited" },
                  overridden: {
                    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      expect((yield* models.get(providerID, inheritedID))?.capabilities).toEqual({
        tools: false,
        input: ["text"],
        output: ["text"],
      })
      expect((yield* models.get(providerID, overriddenID))?.capabilities).toEqual({
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      })
    }),
  )

  for (const scenario of [
    { name: "omitted capabilities", legacy: {}, overrides: {} },
    {
      name: "input-only modalities",
      legacy: { modalities: { input: ["text", "image", "pdf"] } },
      overrides: { input: ["text", "image", "pdf"] },
    },
    {
      name: "output-only modalities",
      legacy: { modalities: { output: ["audio"] } },
      overrides: { output: ["audio"] },
    },
    { name: "enabled tools", legacy: { tool_call: true }, overrides: { tools: true } },
    { name: "disabled tools", legacy: { tool_call: false }, overrides: { tools: false } },
    {
      name: "explicit empty modalities",
      legacy: { modalities: { input: [], output: [] } },
      overrides: { input: [], output: [] },
    },
    {
      name: "fully specified capabilities",
      legacy: { tool_call: false, modalities: { input: ["audio"], output: ["text"] } },
      overrides: { tools: false, input: ["audio"], output: ["text"] },
    },
  ]) {
    it.effect(`uses native model defaults for migrated ${scenario.name}`, () =>
      Effect.gen(function* () {
        const models = yield* Model.Service
        const providerID = Provider.ID.make("custom")
        const result = ConfigNormalize.normalize({ provider: { custom: { models: { migrated: scenario.legacy } } } })
        if (result.type !== "normalized") throw new Error("Expected normalized config")
        expect(result.diagnostics).toEqual([])

        yield* addPlugin([
          new Document({
            type: "document",
            info: decode({ providers: { custom: { models: { native: {} } } } }),
          }),
          new Document({ type: "document", info: decode(result.encoded) }),
        ])

        const native = required(yield* models.get(providerID, Model.ID.make("native")))
        const migrated = required(yield* models.get(providerID, Model.ID.make("migrated")))
        expect(migrated).toEqual({
          ...native,
          id: migrated.id,
          modelID: migrated.id,
          name: migrated.id,
          capabilities: { ...native.capabilities, ...scenario.overrides },
        })
      }),
    )
  }

  for (const scenario of [
    {
      name: "provider package and request defaults",
      legacy: {
        npm: "@ai-sdk/openai",
        api: "https://proxy.example/v1",
        options: { headers: { "x-provider": "default" }, body: { store: false } },
        models: { chat: {} },
      },
      native: {
        package: "aisdk:@ai-sdk/openai",
        settings: { baseURL: "https://proxy.example/v1" },
        headers: { "x-provider": "default" },
        body: { store: false },
        models: { chat: {} },
      },
    },
    {
      name: "model package, limits, costs, and variant overrides",
      legacy: {
        npm: "@ai-sdk/openai",
        api: "https://proxy.example/v1",
        models: {
          chat: {
            id: "vendor/chat",
            name: "Custom chat",
            provider: { npm: "@ai-sdk/anthropic", api: "https://model.example/v1" },
            limit: { context: 100000, input: 80000, output: 16000 },
            cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
            options: { temperature: 0.2 },
            variants: { high: { effort: "high" } },
          },
        },
      },
      native: {
        package: "aisdk:@ai-sdk/openai",
        settings: { baseURL: "https://proxy.example/v1" },
        models: {
          chat: {
            modelID: "vendor/chat",
            name: "Custom chat",
            package: "aisdk:@ai-sdk/anthropic",
            settings: { baseURL: "https://model.example/v1", temperature: 0.2 },
            limit: { context: 100000, input: 80000, output: 16000 },
            cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
            variants: [{ id: "high", settings: { effort: "high" } }],
          },
        },
      },
    },
    {
      name: "zero costs and omitted cache costs",
      legacy: { models: { chat: { cost: { input: 0, output: 0 } } } },
      native: { models: { chat: { cost: { input: 0, output: 0 } } } },
    },
  ]) {
    it.effect(`matches native configuration for migrated ${scenario.name}`, () =>
      Effect.gen(function* () {
        const models = yield* Model.Service
        const result = ConfigNormalize.normalize({ provider: { legacy: scenario.legacy } })
        if (result.type !== "normalized") throw new Error("Expected normalized config")
        expect(result.diagnostics).toEqual([])

        yield* addPlugin([
          new Document({ type: "document", info: decode({ providers: { native: scenario.native } }) }),
          new Document({ type: "document", info: decode(result.encoded) }),
        ])

        const native = required(yield* models.get(Provider.ID.make("native"), Model.ID.make("chat")))
        const migrated = required(yield* models.get(Provider.ID.make("legacy"), Model.ID.make("chat")))
        expect({ ...migrated, providerID: native.providerID }).toEqual(native)
        for (const variant of native.variants) {
          const expected = yield* ModelResolver.withVariant(native, variant.id)
          const actual = yield* ModelResolver.withVariant(migrated, variant.id)
          expect({ ...actual, providerID: expected.providerID }).toEqual(expected)
        }
      }),
    )
  }

  it.effect("preserves existing catalog metadata when migrated fields are omitted", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const providerID = Provider.ID.make("custom")
      const modelID = Model.ID.make("chat")
      yield* providers.transform((editor) => {
        editor.models.update(providerID, modelID, (model) => {
          model.package = "aisdk:@ai-sdk/anthropic"
          model.settings = { baseURL: "https://catalog.example/v1" }
          model.capabilities = { tools: false, input: ["audio"], output: ["audio"] }
          model.limit = { context: 100000, input: 80000, output: 16000 }
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
            },
          ]
          model.variants = [{ id: Model.VariantID.make("high"), settings: { effort: "high" } }]
        })
      })
      const before = required(yield* models.get(providerID, modelID))
      const result = ConfigNormalize.normalize({ provider: { custom: { models: { chat: {} } } } })
      if (result.type !== "normalized") throw new Error("Expected normalized config")
      expect(result.diagnostics).toEqual([])
      yield* addPlugin([new Document({ type: "document", info: decode(result.encoded) })])
      expect(yield* models.get(providerID, modelID)).toEqual(before)
    }),
  )

  it.effect("generates variants after rewriting a configured model package", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              custom: {
                package: "aisdk:@ai-sdk/openai",
                models: {
                  claude: {
                    modelID: "claude-opus-4-8",
                    package: "aisdk:@ai-sdk/anthropic",
                  },
                },
              },
            },
          }),
        }),
      ])

      const model = required(yield* models.get(Provider.ID.make("custom"), Model.ID.make("claude")))
      expect(model.package).toBe("@opencode/ai/providers/anthropic")
      expect(model.variants.map((variant) => variant.id)).toEqual([
        Model.VariantID.make("low"),
        Model.VariantID.make("medium"),
        Model.VariantID.make("high"),
        Model.VariantID.make("xhigh"),
        Model.VariantID.make("max"),
      ])
    }),
  )

  it.effect("keeps configured model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providerID = Provider.ID.opencode
      const modelID = Model.ID.make("alpha-gpt-next")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                package: "aisdk:@ai-sdk/openai",
                settings: { baseURL: "https://opencode.test/v1" },
                models: {
                  "alpha-gpt-next": {
                    variants: [
                      {
                        id: "high",
                        body: {
                          reasoningEffort: "high",
                          reasoningSummary: "auto",
                          include: ["reasoning.encrypted_content"],
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* models.get(providerID, modelID))
      expect(model.variants?.find((variant) => variant.id === "high")?.body).toMatchObject({
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    }),
  )

  it.effect("keeps layered model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providerID = Provider.ID.opencode
      const modelID = Model.ID.make("alpha-gpt-next")
      const entries = [
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                package: "aisdk:@ai-sdk/openai",
                settings: { baseURL: "https://opencode.test/v1" },
              },
            },
          }),
        }),
        new Document({
          type: "document",
          info: decode({
            providers: {
              opencode: {
                models: {
                  "alpha-gpt-next": {
                    variants: [{ id: "high", body: { reasoningEffort: "high" } }],
                  },
                },
              },
            },
          }),
        }),
      ]

      yield* addPlugin(entries)

      const model = required(yield* models.get(providerID, modelID))
      expect(model.variants?.find((variant) => variant.id === "high")?.body).toMatchObject({
        reasoningEffort: "high",
      })
    }),
  )

  it.effect("loads configured providers and applies later model overrides", () =>
    withEnv({ CUSTOM_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        const integrations = yield* Integration.Service
        const providerID = Provider.ID.make("custom")
        const modelID = Model.ID.make("chat")
        const entries = [
          new Document({
            type: "document",
            info: decode({
              model: "custom/first",
              providers: {
                custom: {
                  name: "Configured",
                  canonical: "anthropic",
                  env: ["CUSTOM_API_KEY"],
                  package: "native",
                  headers: { first: "first", shared: "first" },
                  models: {
                    chat: {
                      name: "First",
                      compatibility: {
                        reasoningField: "vendor_reasoning",
                        maxTokensField: "max_completion_tokens",
                        requireFinishReason: false,
                      },
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      disabled: true,
                      limit: { context: 100, output: 50 },
                      cost: { input: 1, output: 2 },
                      settings: { retained: true },
                      headers: { first: "first", shared: "first" },
                      variants: [
                        {
                          id: "fast",
                          headers: { first: "first", shared: "first" },
                        },
                      ],
                    },
                  },
                },
              },
            }),
          }),
          new Document({
            type: "document",
            info: decode({
              model: "custom/default",
              providers: {
                custom: {
                  package: "aisdk:custom-sdk",
                  canonical: "anthropic",
                  settings: { baseURL: "https://example.test" },
                  headers: { last: "last", shared: "last" },
                  models: {
                    default: {
                      name: "Default",
                    },
                    chat: {
                      modelID: "api-chat",
                      name: "Last",
                      limit: { output: 75 },
                      headers: { last: "last", shared: "last" },
                      variants: [
                        {
                          id: "fast",
                          headers: { last: "last", shared: "last" },
                        },
                        {
                          id: "slow",
                          headers: { slow: "slow" },
                        },
                      ],
                    },
                  },
                },
              },
            }),
          }),
          new Document({
            type: "document",
            info: decode({
              providers: {
                custom: { name: "Renamed" },
              },
            }),
          }),
        ]

        yield* providers.transform((editor) => {
          editor.update(Provider.ID.anthropic, (provider) => {
            provider.package = "aisdk:@ai-sdk/anthropic"
          })
          editor.models.update(Provider.ID.anthropic, modelID, (model) => {
            model.variants = [{ id: Model.VariantID.make("fast"), settings: { effort: "high" } }]
          })
        })
        yield* addPlugin(entries)

        const provider = required(yield* providers.get(providerID))
        const model = required(yield* models.get(providerID, modelID))
        expect((yield* models.default())?.id).toBe(Model.ID.make("default"))
        expect(provider.name).toBe("Renamed")
        expect(provider.canonical).toBe(Provider.ID.anthropic)
        expect(model.canonical).toBe(Provider.ID.anthropic)
        expect(model.providerID).toBe(providerID)
        expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toContainEqual({
          type: "env",
          names: ["CUSTOM_API_KEY"],
        })
        expect((yield* integrations.get(Integration.ID.make("custom")))?.name).toBe("Renamed")
        expect(provider.activation).toBe("enabled")
        expect(provider.package).toBe("aisdk:custom-sdk")
        expect(model.package).toBe("aisdk:custom-sdk")
        expect(provider.settings).toEqual({ baseURL: "https://example.test" })
        expect(provider.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.id).toBe(modelID)
        expect(model.modelID).toBe(Model.ID.make("api-chat"))
        expect(model.name).toBe("Last")
        expect(model.compatibility).toEqual({
          reasoningField: "vendor_reasoning",
          maxTokensField: "max_completion_tokens",
          requireFinishReason: false,
        })
        expect(model.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
        expect(model.enabled).toBe(false)
        expect(model.limit).toEqual({ context: 100, output: 75 })
        expect(model.cost).toEqual([
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: {
              read: Money.USDPerMillionTokens.zero,
              write: Money.USDPerMillionTokens.zero,
            },
            tier: undefined,
          },
        ])
        expect(model.settings).toEqual({ baseURL: "https://example.test", retained: true })
        expect(model.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants?.map((variant) => variant.id)).toEqual([
          Model.VariantID.make("fast"),
          Model.VariantID.make("slow"),
        ])
        expect(model.variants?.[0]?.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants?.[0]?.settings).toEqual({ effort: "high" })
        expect(model.variants?.[1]?.headers).toEqual({ slow: "slow" })
      }),
    ),
  )
})
