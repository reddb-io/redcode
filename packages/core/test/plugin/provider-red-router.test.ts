import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Mcp } from "@opencode/core/mcp/index"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { catalogChanges, RedRouterPlugin, routerModel } from "@opencode/core/plugin/provider/red-router"
import { Provider } from "@opencode/core/provider"
import { ProviderRouter } from "@opencode/core/provider-router"
import { Agent } from "@opencode/schema/agent"
import { SessionID } from "@opencode/schema/session-id"
import { Effect, Schedule } from "effect"
import { withEnv } from "../fixture/env"
import { emptyMcp } from "../fixture/mcp"
import { advance, drain } from "../lib/clock"
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
  test("keeps Jev Router in S2 and excludes typed decision evaluators", () => {
    const names = { providers: new Map<string, string>(), models: new Map<string, string>(), limits: new Map() }
    const map = (item: Parameters<typeof routerModel>[0]) => routerModel(item, Provider.ID.make("red-router"), names)
    expect(
      map({
        id: "red/red/openrouter/typesafe/jev-router",
        type: "chat",
        supported_endpoints: ["/v1/chat/completions"],
      }),
    ).toMatchObject([
      { id: "red/red/openrouter/typesafe/jev-router", package: "@opencode/ai/providers/openai-compatible" },
    ])
    expect(map({ id: "red/openrouter/typesafe/jev-1.13" })).toEqual([])
    expect(map({ id: "decision-only", capabilities: { decision: true } })).toEqual([])
    expect(map({ id: "native-s1", type: "systemone" })).toEqual([])
  })

  test("counts the models a catalog refresh added and removed", () => {
    const ids = (...values: string[]) => values.map((id) => ({ id }))
    expect(catalogChanges(ids("a", "b", "c"), ids("b", "c", "d", "e"))).toEqual({ added: 2, removed: 1, renamed: 0 })
    expect(catalogChanges(ids("a"), ids("a"))).toEqual({ added: 0, removed: 0, renamed: 0 })
  })

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

  describe("reasoning variants", () => {
    const names = { providers: new Map(), models: new Map(), limits: new Map() }
    const item = { id: "combo/coder", parameters: { reasoning: true, thinking_levels: ["low", "auto", "high"] } }

    test("puts auto first when the router's autopilot accepts it and there are levels to choose between", () => {
      const [model] = routerModel(item, Provider.ID.make("red-router"), names, new Set(["reasoning", "reasoning-auto"]))
      expect(model?.variants).toEqual([
        { id: Model.VariantID.make("auto") },
        { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
        { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
      ])
      expect(model?.reasoningVariantIDs).toEqual(["auto", "low", "high"].map((id) => Model.VariantID.make(id)))
    })

    test("offers no auto without the router's autopilot or with a single level", () => {
      const [plain] = routerModel(item, Provider.ID.make("red-router"), names)
      expect(plain?.variants.map((variant) => variant.id)).toEqual(
        ["low", "high"].map((id) => Model.VariantID.make(id)),
      )
      const [single] = routerModel(
        { id: "combo/coder", parameters: { reasoning: true, thinking_levels: ["high"] } },
        Provider.ID.make("red-router"),
        names,
        new Set(["reasoning", "reasoning-auto"]),
      )
      expect(single?.variants.map((variant) => variant.id)).toEqual([Model.VariantID.make("high")])
    })
  })

  test("models a flat id's offers and pins each pinnable one as its own model", () => {
    const [flat, ...pinned] = routerModel(
      {
        id: "anthropic/claude-sonnet-4-6",
        flat: true,
        owned_by: "combo",
        parameters: {
          context_length: 200_000,
          max_completion_tokens: 32_000,
          reasoning: true,
          thinking_levels: ["low", "high"],
        },
        offers: [
          {
            id: "red-router/anthropic/claude-sonnet-4-6",
            pin_id: "anthropic/claude-sonnet-4-6@anthropic",
            provider: { id: "anthropic", name: "Anthropic" },
            via: [{ slug: "red-router", name: "RedRouter" }],
            available: true,
            price: { input: 3, output: 15 },
          },
          // The vendor's own offer id is the flat id: it cannot pin.
          {
            id: "openrouter/anthropic/claude-sonnet-4-6",
            pin_id: "anthropic/claude-sonnet-4-6",
            provider: { id: "openrouter" },
          },
          {
            id: "bedrock/anthropic/claude-sonnet-4-6",
            pin_id: "bedrock:anthropic/claude-sonnet-4-6",
            provider: { id: "amazon-bedrock", slug: "bedrock" },
            available: false,
            free: true,
          },
          { id: "broken" },
        ],
        member_parameters: [
          {
            id: "bedrock/anthropic/claude-sonnet-4-6",
            parameters: { context_length: 100_000, max_completion_tokens: 8_000, thinking_levels: ["high"] },
          },
        ],
      },
      Provider.ID.make("red-router"),
      { providers: new Map([["amazon-bedrock", "Amazon Bedrock"]]), models: new Map(), limits: new Map() },
    )

    expect(flat?.offers).toEqual([
      {
        id: "red-router/anthropic/claude-sonnet-4-6",
        pinID: "anthropic/claude-sonnet-4-6@anthropic",
        provider: { id: "anthropic", name: "Anthropic" },
        via: [{ slug: "red-router", name: "RedRouter" }],
        available: true,
        price: { input: 3, output: 15 },
        free: false,
      },
      {
        id: "openrouter/anthropic/claude-sonnet-4-6",
        provider: { id: "openrouter", name: "openrouter" },
        via: [],
        available: true,
        free: false,
      },
      {
        id: "bedrock/anthropic/claude-sonnet-4-6",
        pinID: "bedrock:anthropic/claude-sonnet-4-6",
        provider: { id: "amazon-bedrock", name: "Amazon Bedrock", slug: "bedrock" },
        via: [],
        available: false,
        free: true,
      },
    ])
    expect(flat).toMatchObject({ flat: true, upstream: { id: "anthropic" }, via: "RedRouter" })
    expect(pinned.map((model) => model.id)).toEqual(
      ["anthropic/claude-sonnet-4-6@anthropic", "bedrock:anthropic/claude-sonnet-4-6"].map((id) => Model.ID.make(id)),
    )
    expect(pinned[0]).toMatchObject({
      pinOf: "anthropic/claude-sonnet-4-6",
      upstream: { id: "anthropic", name: "Anthropic" },
      via: "RedRouter",
      cost: [{ input: 3, output: 15, cache: { read: 0, write: 0 } }],
      limit: { context: 200_000, output: 32_000 },
    })
    expect(pinned[0]?.variants.map((variant) => variant.id)).toEqual(
      ["low", "high"].map((id) => Model.VariantID.make(id)),
    )
    // A switched-off offer still pins, with its own member's limits and thinking levels.
    expect(pinned[1]).toMatchObject({
      pinOf: "anthropic/claude-sonnet-4-6",
      upstream: { id: "amazon-bedrock", slug: "bedrock" },
      cost: [],
      limit: { context: 100_000, output: 8_000 },
    })
    expect(pinned[1]?.flat).toBeUndefined()
    expect(pinned[1]?.variants.map((variant) => variant.id)).toEqual([Model.VariantID.make("high")])
  })

  test("plans a combo without parameters of its own for its strictest member", () => {
    const [combo] = routerModel(
      {
        id: "combo/fallback",
        owned_by: "combo",
        parameters_basis: "strictest",
        member_parameters: [
          {
            id: "a/one",
            parameters: {
              context_length: 400_000,
              max_completion_tokens: 64_000,
              thinking_levels: ["low", "medium", "high"],
              tools: true,
            },
          },
          {
            id: "b/two",
            parameters: {
              context_length: 128_000,
              max_completion_tokens: 16_000,
              thinking_levels: ["medium", "high"],
              tools: true,
              forced_tool_choice: false,
            },
          },
          { id: "c/three" },
        ],
      },
      Provider.ID.make("red-router"),
      { providers: new Map(), models: new Map(), limits: new Map() },
    )
    expect(combo).toMatchObject({
      limit: { context: 128_000, output: 16_000 },
      capabilities: { tools: true, reasoning: true },
      compatibility: { forcedToolChoice: false },
    })
    expect(combo?.variants.map((variant) => variant.id)).toEqual(
      ["medium", "high"].map((id) => Model.VariantID.make(id)),
    )
  })

  test("keeps a lead-based combo's limits but refuses a forced tool choice any member refuses", () => {
    const [combo] = routerModel(
      {
        id: "combo/lead",
        parameters: { context_length: 200_000, forced_tool_choice: true },
        parameters_basis: "lead",
        member_parameters: [{ id: "x/fallback", parameters: { context_length: 32_000, forced_tool_choice: false } }],
      },
      Provider.ID.make("red-router"),
      { providers: new Map(), models: new Map(), limits: new Map() },
    )
    expect(combo?.limit.context).toBe(200_000)
    expect(combo?.compatibility).toEqual({ forcedToolChoice: false })
  })

  it.effect("cooperates with a detected RedRouter: key role, MCP server, request and response headers", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            const path = new URL(request.url).pathname
            if (request.headers.get("authorization") !== "Bearer secret") return new Response(null, { status: 401 })
            if (path === "/v1/capabilities")
              return Response.json({
                product: "red-router",
                version: "1.2.3",
                instance_id: "instance-1",
                decision: { header: "x-red-router-decision", accepts_hint: true },
                token_saver_header: "x-red-router-token-saver",
                reasoning: { header: "x-red-router-reasoning", accepts: ["auto"] },
              })
            if (path === "/v1/models") {
              expect(new URL(request.url).searchParams.get("capabilities")).toBe("chat")
              return Response.json(
                {
                  data: [
                    {
                      id: "combo/smart",
                      owned_by: "combo",
                      strategy: "smart",
                      parameters: { thinking_levels: ["low", "high"] },
                    },
                  ],
                },
                {
                  headers: {
                    "x-redrouter-key-role": "admin",
                    "x-redrouter-mcp": "/v1/mcp",
                    "x-redrouter-catalog-version": "v1",
                  },
                },
              )
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
          Effect.gen(function* () {
            const origin = server.url.origin
            const transforms: Array<(editor: Mcp.Editor) => void> = []
            const servers = () => {
              const configured = new Map<string, unknown>()
              transforms.forEach((transform) =>
                transform({
                  list: () => [],
                  get: (name) => (configured.has(name) ? { type: "remote", url: "user" } : undefined),
                  set: (name, config) => configured.set(name, config),
                  update: () => {},
                  remove: (name) => configured.delete(name),
                }),
              )
              return Object.fromEntries(configured)
            }
            yield* (yield* Credential.Service).create({
              integrationID,
              value: Credential.Key.make({ type: "key", key: "secret", configuration: { baseURL: `${origin}/v1` } }),
            })
            yield* addPlugin().pipe(
              Effect.provideService(
                Mcp.Service,
                Mcp.Service.of({
                  ...emptyMcp,
                  transform: (transform) =>
                    Effect.sync(() => {
                      transforms.push(transform)
                      return { dispose: Effect.void }
                    }),
                }),
              ),
            )
            yield* advance(() => Object.keys(servers()).length > 0)
            yield* drain

            // The key's MCP server is registered with the key, and a server the user declared wins.
            expect(servers()).toEqual({
              "red-router": {
                type: "remote",
                url: `${origin}/v1/mcp`,
                headers: { Authorization: "Bearer secret" },
                oauth: false,
              },
            })
            const providers = yield* Provider.Service
            expect((yield* providers.get(Provider.ID.make("red-router")))?.router).toEqual({
              kind: "red-router",
              instanceID: "instance-1",
              version: "1.2.3",
              role: "admin",
              mcp: `${origin}/v1/mcp`,
            })
            const models = yield* Model.Service
            expect(
              (yield* models.get(Provider.ID.make("red-router"), Model.ID.make("combo/smart")))?.variants.map(
                (variant) => variant.id,
              ),
            ).toEqual(["auto", "low", "high"].map((id) => Model.VariantID.make(id)))

            const hooks = yield* PluginHooks.Service
            const sessionID = SessionID.create()
            ProviderRouter.guide(sessionID, { hint: "complexity=0.8", decision: false })
            const request = yield* hooks.trigger("session", "model.request", {
              sessionID,
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({
                providerID: Provider.ID.make("red-router"),
                id: Model.ID.make("combo/smart"),
                variant: Model.VariantID.make("auto"),
              }),
              kind: "compaction",
              headers: {},
            })
            expect(request.headers).toEqual({
              "x-red-router-reasoning": "auto",
              "x-red-router-hint": "complexity=0.8",
              "x-red-router-decision": "off",
              "x-red-router-token-saver": "off",
            })
            ProviderRouter.guide(sessionID, undefined)

            yield* hooks.trigger("session", "http.response", {
              sessionID,
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({ providerID: Provider.ID.make("red-router"), id: Model.ID.make("combo/smart") }),
              kind: "primary",
              request: new Request(`${origin}/v1/chat/completions`),
              response: new Response("{}", {
                headers: {
                  "content-type": "application/json",
                  "x-redrouter-served-model": "anthropic/claude-sonnet-4-6",
                  "x-redrouter-cost-usd": "0.01",
                  "x-redrouter-catalog-version": "v1",
                },
              }),
            })
            expect(ProviderRouter.take(sessionID)).toEqual({
              servedModel: "anthropic/claude-sonnet-4-6",
              costUSD: 0.01,
              catalogVersion: "v1",
            })
          }),
        ),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("hides the previous account's models while the new account's catalog loads", () => {
    const cache = Promise.withResolvers<void>()
    const pending = { hold: false, reached: false }
    return Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) => {
            if (new URL(request.url).pathname !== "/v1/models") return new Response(null, { status: 404 })
            const account = request.headers.get("authorization") === "Bearer first" ? "first" : "second"
            return Response.json({ data: [{ id: `account/${account}` }] })
          },
        }),
      ),
      (server) =>
        withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const first = yield* credentials.create({
              integrationID,
              label: "first",
              value: Credential.Key.make({
                type: "key",
                key: "first",
                configuration: { baseURL: `${server.url.origin}/v1` },
              }),
            })
            const second = yield* credentials.create({
              integrationID,
              label: "second",
              value: Credential.Key.make({
                type: "key",
                key: "second",
                configuration: { baseURL: `${server.url.origin}/v1` },
              }),
            })
            yield* credentials.activate(first.id)
            const kv = yield* KV.Service
            yield* addPlugin().pipe(
              Effect.provideService(
                KV.Service,
                KV.Service.of({
                  ...kv,
                  get: (key) =>
                    Effect.gen(function* () {
                      if (pending.hold) {
                        pending.reached = true
                        yield* Effect.promise(() => cache.promise)
                      }
                      return yield* kv.get(key)
                    }),
                }),
              ),
            )
            const models = yield* Model.Service
            const observed = new Set<string>()
            yield* models.available().pipe(
              Effect.tap((catalog) => Effect.sync(() => catalog.forEach((model) => observed.add(model.id)))),
              Effect.repeat(Schedule.spaced("1 millis")),
              Effect.forkScoped,
            )
            yield* advance(() => observed.has("account/first"))
            pending.hold = true
            yield* credentials.activate(second.id)
            yield* advance(() => pending.reached)
            expect((yield* models.available()).filter((model) => model.providerID === "red-router")).toEqual([])
            pending.hold = false
            cache.resolve()
            yield* advance(() => observed.has("account/second"))
            expect(
              (yield* models.available()).filter((model) => model.providerID === "red-router").map((model) => model.id),
            ).toEqual([Model.ID.make("account/second")])
          }),
        ),
      (server) =>
        Effect.promise(() => {
          cache.resolve()
          return server.stop(true)
        }),
    )
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
