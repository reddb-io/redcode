import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { RedRouterPlugin, routerModel } from "@opencode/core/plugin/provider/red-router"
import { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("red-router")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* RedRouterPlugin.effect(host)
})

describe("RedRouterPlugin", () => {
  test("uses router parameters for limits, tools, modalities, and declared thinking levels", () => {
    const models = routerModel(
      {
        id: "oc/gpt-6-astra",
        owned_by: "opencode",
        api_format: "chat-completions",
        supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
        context_length: 200_000,
        max_output_tokens: 16_000,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        capabilities: { tool_calling: true, reasoning: true, effort_tiers: ["low", "medium", "high"] },
        parameters: {
          context_length: 100_000,
          max_completion_tokens: 8_000,
          tools: false,
          thinking_levels: ["none", "high"],
          thinking_can_disable: false,
          modalities: { input: ["text"], output: ["text"] },
        },
      },
      Provider.ID.make("red-router"),
      {
        providers: new Map([["opencode", "OpenCode"]]),
        models: new Map([["opencode/gpt-6-astra", "GPT-6 Astra"]]),
        limits: new Map(),
      },
    )

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: "oc/gpt-6-astra",
      name: "GPT-6 Astra",
      package: "@opencode/ai/providers/openai-compatible",
      capabilities: { tools: false, reasoning: true, input: ["text"], output: ["text"] },
      limit: { context: 100_000, output: 8_000 },
      variants: [{ id: "high", settings: { reasoningEffort: "high" } }],
      reasoningVariantIDs: ["high"],
    })
  })

  test("keeps an explicit no-thinking contract and selects the responses transport", () => {
    const models = routerModel(
      {
        id: "anthropic/claude-sonnet-4-6",
        api_format: "responses",
        parameters: { reasoning: false, thinking_levels: null, tools: true },
        capabilities: { reasoning: true, effort_tiers: ["low", "high"] },
      },
      Provider.ID.make("9router"),
      { providers: new Map(), models: new Map(), limits: new Map() },
    )

    expect(models[0]).toMatchObject({
      id: "anthropic/claude-sonnet-4-6",
      package: "@opencode/ai/providers/openai-compatible-responses",
      capabilities: { reasoning: false, tools: true },
      variants: [],
    })
  })

  describe("limits", () => {
    const names = {
      providers: new Map<string, string>(),
      models: new Map<string, string>(),
      limits: new Map([["claude-opus-5-5", { context: 1_000_000, output: 128_000 }]]),
    }
    const limit = (item: Parameters<typeof routerModel>[0]) =>
      routerModel(item, Provider.ID.make("9router"), names)[0]?.limit

    test("reads max_input_tokens as the context and keeps it as the input limit", () => {
      expect(limit({ id: "local/qwen", max_input_tokens: 32_768, max_output_tokens: 4_000 })).toEqual({
        context: 32_768,
        output: 4_000,
      })
      expect(
        limit({ id: "local/qwen", context_length: 40_960, max_input_tokens: 32_768, max_output_tokens: 4_000 }),
      ).toEqual({ context: 40_960, input: 32_768, output: 4_000 })
    })

    test("reads OpenRouter top_provider limits and ignores null values", () => {
      expect(
        limit({
          id: "openai/gpt-6-luna",
          context_length: null,
          top_provider: { context_length: 400_000, max_completion_tokens: 128_000 },
        }),
      ).toEqual({ context: 400_000, output: 128_000 })
    })

    test("falls back to the models catalog through router prefixes", () => {
      expect(limit({ id: "cc/claude-opus-5-5" })).toEqual({ context: 1_000_000, output: 128_000 })
    })

    test("guesses an unknown context held back by the estimate reserve", () => {
      expect(limit({ id: "unknown/model" })).toEqual({ context: 115_200, output: 8_192 })
      expect(limit({ id: "unknown/model", context_length: 0, max_output_tokens: 1_000 })).toEqual({
        context: 115_200,
        output: 1_000,
      })
    })

    test("caps the output at the context", () => {
      expect(limit({ id: "small/model", context_length: 4_096, max_output_tokens: 8_192 })).toEqual({
        context: 4_096,
        output: 4_096,
      })
    })
  })

  test("carries a declared forced tool choice refusal into compatibility", () => {
    const [model] = routerModel(
      { id: "combo/structured", parameters: { forced_tool_choice: false } },
      Provider.ID.make("red-router"),
      { providers: new Map(), models: new Map(), limits: new Map() },
    )
    expect(model?.compatibility).toEqual({ forcedToolChoice: false })
  })

  it.effect("asks for the API endpoint and stores it with the key", () =>
    withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: "https://router.example/v1" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const integrations = yield* Integration.Service
        expect((yield* integrations.get(integrationID))?.methods).toContainEqual({
          type: "key",
          label: "RedRouter API key",
          form: [
            {
              type: "string",
              key: "baseURL",
              title: "RedRouter API URL",
              description: "The OpenAI-compatible API endpoint, usually ending in /v1.",
              placeholder: "http://127.0.0.1:25050/v1",
              default: "https://router.example/v1",
              format: "uri",
              required: true,
            },
          ],
        })

        yield* integrations.connection.key({
          integrationID,
          key: "secret",
          answer: { baseURL: "https://router.example/v1" },
        })
        expect((yield* (yield* Credential.Service).list(integrationID))[0]?.value).toEqual(
          Credential.Key.make({
            type: "key",
            key: "secret",
            configuration: { baseURL: "https://router.example/v1" },
          }),
        )
      }),
    ),
  )
})
