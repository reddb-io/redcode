import { afterAll, describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Document, Info } from "@opencode/schema/config"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { catalogLimits, knownLimit } from "@opencode/core/plugin/provider/catalog-limits"
import {
  deriveProviderID,
  discover,
  isRedRouter,
  normalizeBaseURL,
  parseEndpoint,
  parseHeaders,
  providerConfig,
  OpenAICompatiblePlugin,
} from "@opencode/core/plugin/provider/openai-compatible"

const largeCatalog = Array.from({ length: 2505 }, (_, index) => ({
  id: `model-${index}`,
  context_length: 64_000,
  max_completion_tokens: 4_000,
}))

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (request.headers.get("authorization") !== "Bearer sk-good") return new Response("no", { status: 401 })
    if (url.pathname === "/v1/models")
      return Response.json({
        data: [
          { id: "alpha", name: "Alpha", context_length: 64_000, max_completion_tokens: 4_000 },
          { id: "beta", context_window: null },
          { unexpected: true },
        ],
      })
    if (url.pathname === "/plain/models") return new Response("not json")
    if (url.pathname === "/large/models") return Response.json({ data: largeCatalog })
    if (url.pathname === "/rr/v1/capabilities") return Response.json({ product: "red-router" })
    if (url.pathname === "/old/v1/models/systemone")
      return Response.json({ data: [{ id: "jev-small" }, { id: "jev-large" }] })
    if (url.pathname === "/mixed/v1/models/systemone") return Response.json({ data: [{ id: "jev" }, { id: "gpt" }] })
    return new Response("missing", { status: 404 })
  },
})
afterAll(() => server.stop(true))

const it = testEffect(PluginTestLayer)

it.effect("adds independent endpoints on the same host and multiple credentials for an existing endpoint", () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const saved: Record<string, Record<string, unknown>> = {}
    yield* OpenAICompatiblePlugin.effect(host).pipe(
      Effect.provideService(Config.Service, {
        ...config,
        entries: () =>
          Effect.sync(() => [
            new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({ providers: saved }),
            }),
          ]),
        saveProvider: (id, provider) =>
          Effect.sync(() => {
            saved[id] = provider
            return "test-config.json"
          }),
      }),
    )
    const connect = (baseURL: string, providerID?: string) =>
      integrations.connection.key({
        integrationID: Integration.ID.make("openai-compatible"),
        key: "sk-good",
        answer: { baseURL, ...(providerID ? { advanced: true, providerID, api: "chat" } : {}) },
      })
    const firstURL = `${server.url.origin}/v1`
    const secondURL = `${server.url.origin}/large`
    const firstID = deriveProviderID(firstURL)
    yield* connect(firstURL)
    const firstConfig = structuredClone(saved[firstID])
    const first = (yield* credentials.list(Integration.ID.make(firstID)))[0]
    yield* connect(secondURL)
    expect(saved[firstID]).toEqual(firstConfig)
    expect(saved[`${firstID}-2`]).toMatchObject({ settings: { baseURL: secondURL } })
    expect((yield* credentials.list(Integration.ID.make(firstID))).map((item) => item.id)).toEqual([first.id])

    yield* connect(`${firstURL}/`)
    const accounts = yield* credentials.list(Integration.ID.make(firstID))
    expect(accounts).toHaveLength(2)
    expect(accounts.find((item) => item.id === first.id)?.value).toEqual(first.value)
    expect(Object.keys(saved)).toEqual([firstID, `${firstID}-2`])

    const rejected = yield* connect(secondURL, firstID).pipe(Effect.flip)
    expect(rejected.cause).toMatchObject({
      message: `${firstID} already uses another endpoint; choose another provider ID`,
    })
    expect(saved[firstID]).toEqual(firstConfig)
    expect(yield* credentials.list(Integration.ID.make(firstID))).toHaveLength(2)
  }),
)

const endpoint = (answer: Record<string, string | number>) => {
  const parsed = parseEndpoint({ providerID: "local", ...answer })
  if (typeof parsed === "string") throw new Error(parsed)
  return parsed
}

describe("OpenAI-compatible wizard answers", () => {
  test("normalizes a pasted endpoint URL and rejects unsafe ones", () => {
    expect(normalizeBaseURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1")
    expect(normalizeBaseURL("https://api.example.com/v1/chat/completions")).toBe("https://api.example.com/v1")
    expect(normalizeBaseURL("http://127.0.0.1:8080/v1/models")).toBe("http://127.0.0.1:8080/v1")
    expect(normalizeBaseURL("ftp://example.com/v1")).toBeUndefined()
    expect(normalizeBaseURL("https://user:pass@example.com/v1")).toBeUndefined()
    expect(normalizeBaseURL("https://example.com/v1?key=secret")).toBeUndefined()
    expect(normalizeBaseURL("not a url")).toBeUndefined()
  })

  test("reads headers and refuses credential headers in plain configuration", () => {
    expect(parseHeaders("X-Org: acme; X-Env: prod")).toEqual({ "X-Org": "acme", "X-Env": "prod" })
    expect(parseHeaders("")).toEqual({})
    expect(parseHeaders("Authorization: Bearer secret")).toBe(
      "Authorization carries a credential; enter the key as the API key instead",
    )
    expect(parseHeaders("no separator")).toBe("Headers must be written as Name: value; this one is not: no separator")
  })

  test("validates the provider ID and fills the defaults", () => {
    expect(parseEndpoint({ baseURL: "https://api.example.com/v1", providerID: "My Endpoint" })).toStartWith(
      "The provider ID must be",
    )
    expect(parseEndpoint({ baseURL: "file:///tmp", providerID: "local" })).toStartWith("The API base URL must be")
    expect(
      parseEndpoint({
        baseURL: "https://api.example.com/v1/",
        providerID: "local",
        api: "responses",
        models: "a, b, a",
        context: 32_000,
      }),
    ).toEqual({
      providerID: "local",
      name: "local",
      baseURL: "https://api.example.com/v1",
      responses: true,
      headers: {},
      models: ["a", "b"],
      context: 32_000,
    })
  })

  test("asks for nothing but the URL: the provider ID and name come from the host", () => {
    expect(deriveProviderID("https://api.example.com/v1")).toBe("api-example-com")
    expect(deriveProviderID("http://localhost:1234/v1")).toBe("localhost-1234")
    expect(deriveProviderID("http://127.0.0.1:8080")).toBe("127-0-0-1-8080")
    expect(deriveProviderID("not a url")).toBe("endpoint")
    expect(parseEndpoint({ baseURL: "https://api.example.com/v1" })).toEqual({
      providerID: "api-example-com",
      name: "api.example.com",
      baseURL: "https://api.example.com/v1",
      responses: false,
      headers: {},
      models: [],
    })
    // A provider ID the user typed is kept, and names the provider when no display name was given.
    expect(parseEndpoint({ baseURL: "https://api.example.com/v1", providerID: "mine" })).toMatchObject({
      providerID: "mine",
      name: "mine",
    })
  })

  test("reads a model's limits from whichever field the endpoint uses", () => {
    const config = providerConfig(endpoint({ baseURL: "https://api.example.com/v1" }), [
      { id: "vllm", max_model_len: 32_768 },
      { id: "lmstudio", loaded_context_length: 16_384 },
      { id: "openrouter", top_provider: { context_length: 200_000, max_completion_tokens: 16_000 } },
      { id: "llamacpp", meta: { n_ctx_train: 8_192 } },
      { id: "silent" },
    ])
    expect(config.models.vllm?.limit.context).toBe(32_768)
    expect(config.models.lmstudio?.limit.context).toBe(16_384)
    expect(config.models.openrouter?.limit).toEqual({ context: 200_000, output: 16_000 })
    expect(config.models.llamacpp?.limit.context).toBe(8_192)
    expect(config.models.silent?.limit.context).toBeGreaterThan(0)
  })

  test("writes discovered and entered models with their limits", () => {
    const config = providerConfig(endpoint({ baseURL: "https://api.example.com/v1", models: "gamma", output: 2_000 }), [
      { id: "alpha", name: "Alpha", context_length: 64_000 },
    ])
    expect(config.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(config.settings).toEqual({ baseURL: "https://api.example.com/v1", provider: "local" })
    expect(config.models.alpha).toEqual({ name: "Alpha", limit: { context: 64_000, output: 2_000 } })
    expect(config.models.gamma?.name).toBe("gamma")
    expect(config.models.gamma?.limit.output).toBe(2_000)
    expect(config.models.gamma?.limit.context).toBeLessThan(128_000)
    expect(config).not.toHaveProperty("headers")
  })
})

describe("OpenAI-compatible discovery", () => {
  const base = `http://127.0.0.1:${server.port}`

  test("tests the key and lists the endpoint's models", async () => {
    const listed = await Effect.runPromise(discover(endpoint({ baseURL: `${base}/v1` }), "sk-good"))
    expect(listed.map((model) => model.id)).toEqual(["alpha", "beta"])
  })

  test("keeps all 2505 discovered models and manually added IDs in the saved provider", async () => {
    const configured = endpoint({ baseURL: `${base}/large`, models: "model-0,manual-model" })
    const listed = await Effect.runPromise(discover(configured, "sk-good"))
    expect(listed).toHaveLength(2505)
    const saved = providerConfig(configured, listed)
    expect(Object.keys(saved.models)).toHaveLength(2506)
    expect(saved.models["model-2504"]).toEqual({ name: "model-2504", limit: { context: 64_000, output: 4_000 } })
    expect(saved.models["manual-model"]).toBeDefined()
  })

  test("reports a rejected key even when models were entered", async () => {
    const error = await Effect.runPromise(
      Effect.flip(discover(endpoint({ baseURL: `${base}/v1`, models: "alpha" }), "sk-bad")),
    )
    expect(error.message).toStartWith("The endpoint rejected the API key (HTTP 401")
    expect(error.message).toMatch(/HTTP 401.*ms.*bytes/)
    expect(error.message).not.toContain("sk-bad")
  })

  test("accepts entered models when the endpoint has no model list", async () => {
    expect(
      await Effect.runPromise(discover(endpoint({ baseURL: `${base}/none`, models: "alpha" }), "sk-good")),
    ).toEqual([])
    const missing = await Effect.runPromise(Effect.flip(discover(endpoint({ baseURL: `${base}/none` }), "sk-good")))
    expect(missing.message).toContain("answered HTTP 404")
    const plain = await Effect.runPromise(Effect.flip(discover(endpoint({ baseURL: `${base}/plain` }), "sk-good")))
    expect(plain.message).toContain("did not return an OpenAI model list")
  })

  test("reports an unreachable host", async () => {
    const error = await Effect.runPromise(
      Effect.flip(discover(endpoint({ baseURL: "http://127.0.0.1:9/v1" }), "sk-good")),
    )
    expect(error.message).toStartWith("Could not reach http://127.0.0.1:9/v1/models")
  })
})

describe("OpenAI-compatible endpoints that the catalog and the router know", () => {
  const base = `http://127.0.0.1:${server.port}`
  const at = (path: string) => endpoint({ baseURL: `${base}${path}` })

  test("takes a limit the endpoint did not report from the models catalog, dropping router prefixes", () => {
    const limits = new Map([
      ["gpt-4o", { context: 128_000, output: 16_384 }],
      ["claude-sonnet", { context: 200_000, output: 64_000 }],
    ])
    expect(knownLimit(limits, "gpt-4o")).toEqual({ context: 128_000, output: 16_384 })
    expect(knownLimit(limits, "openai/gpt-4o")).toEqual({ context: 128_000, output: 16_384 })
    expect(knownLimit(limits, "cc/anthropic/claude-sonnet")?.context).toBe(200_000)
    expect(knownLimit(limits, "unknown-model")).toBeUndefined()

    const config = providerConfig(
      endpoint({ baseURL: "https://gw.example.com/v1" }),
      [{ id: "openai/gpt-4o" }, { id: "vllm-own", max_model_len: 32_768 }, { id: "mystery" }],
      limits,
    )
    expect(config.models["openai/gpt-4o"]?.limit).toEqual({ context: 128_000, output: 16_384 })
    // What the endpoint reports wins over the catalog.
    expect(config.models["vllm-own"]?.limit.context).toBe(32_768)
    expect(config.models.mystery?.limit.context).toBeLessThan(128_000)
    expect(catalogLimits([]).size).toBe(0)
  })

  test("recognizes a RedRouter by its capabilities or by serving only System One models", async () => {
    expect(await Effect.runPromise(isRedRouter(at("/rr/v1"), "sk-good"))).toBe(true)
    expect(await Effect.runPromise(isRedRouter(at("/old/v1"), "sk-good"))).toBe(true)
  })

  test("does not take another endpoint for a RedRouter", async () => {
    expect(await Effect.runPromise(isRedRouter(at("/v1"), "sk-good"))).toBe(false)
    expect(await Effect.runPromise(isRedRouter(at("/mixed/v1"), "sk-good"))).toBe(false)
    expect(await Effect.runPromise(isRedRouter(at("/rr/v1"), "sk-wrong"))).toBe(false)
    expect(await Effect.runPromise(isRedRouter(endpoint({ baseURL: "http://127.0.0.1:1/v1" }), "sk-good"))).toBe(false)
  })
})
