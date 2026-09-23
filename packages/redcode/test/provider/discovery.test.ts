import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ProviderDiscovery } from "../../src/provider/discovery"
import { testEffect } from "../lib/effect"

const it = testEffect(FetchHttpClient.layer)

function serve(fetch: (request: Request) => Response | Promise<Response>, options: { idleTimeout?: number } = {}) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch, ...options })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

it.live(
  "times out a model catalog whose response body never finishes",
  () =>
    Effect.gen(function* () {
      const server = yield* serve(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"))
              },
            }),
          ),
        // Bun closes idle requests after 10 seconds by default, which would race discovery's own
        // 10 second timeout and surface as a broken body instead.
        { idleTimeout: 30 },
      )
      const http = yield* HttpClient.HttpClient
      const error = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1`, apiKey: "test" }).pipe(
        Effect.flip,
      )
      expect(error.message).toContain("took too long")
    }),
  15000,
)

it.effect("discovers routed IDs over HTTP, sends only the supplied key and normalizes the catalog", () =>
  Effect.gen(function* () {
    const requests: Array<{ path: string; auth: string | null }> = []
    const server = yield* serve((request) => {
      requests.push({ path: new URL(request.url).pathname, auth: request.headers.get("authorization") })
      return Response.json({
        data: [
          { id: "cc/claude-test", name: "Claude via router" },
          { id: "premium-coding" },
          { id: "premium-coding" },
          { id: "" },
          { id: "__proto__" },
        ],
      })
    })
    const http = yield* HttpClient.HttpClient
    const result = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1///`, apiKey: " test-key " })
    expect(requests).toEqual([{ path: "/v1/models", auth: "Bearer test-key" }])
    expect(result).toEqual({
      baseURL: `${server.url}v1`,
      models: [
        { id: "cc/claude-test", name: "Claude via router", limit: ProviderDiscovery.GUESSED_LIMIT, estimated: true },
        { id: "premium-coding", name: "premium-coding", limit: ProviderDiscovery.GUESSED_LIMIT, estimated: true },
      ],
    })
  }),
)

it.effect("reads limits from the router, then the catalog with router prefixes stripped", () =>
  Effect.gen(function* () {
    const server = yield* serve(() =>
      Response.json({
        data: [
          { id: "reported", context_length: 200000, max_output_tokens: 32000 },
          { id: "alternate", max_context_length: 64000.9, max_output_length: 4096 },
          { id: "cc/claude-test" },
          { id: "context-only", context_window: 32000 },
          { id: "junk", context_length: "big", max_output_tokens: -1 },
        ],
      }),
    )
    const http = yield* HttpClient.HttpClient
    const catalog = ProviderDiscovery.catalogLimits({
      anthropic: { models: { "claude-test": { limit: { context: 200000, output: 64000 } } } },
    })
    const result = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1`, apiKey: "test" }, { catalog })
    expect(Object.fromEntries(result.models.map((model) => [model.id, [model.limit, model.estimated]]))).toEqual({
      reported: [{ context: 200000, output: 32000 }, false],
      alternate: [{ context: 64000, output: 4096 }, false],
      "cc/claude-test": [{ context: 200000, output: 64000 }, false],
      "context-only": [{ context: 32000, output: 8192 }, true],
      junk: [ProviderDiscovery.GUESSED_LIMIT, true],
    })
    expect(result.models.every((model) => model.limit.context > 0)).toBe(true)
  }),
)

describe("catalogLimits", () => {
  test("drops leading path segments and ignores entries without a context", () => {
    const lookup = ProviderDiscovery.catalogLimits({
      empty: { models: { "claude-test": { limit: { context: 0, output: 0 } } } },
      anthropic: { models: { "claude-test": { limit: { context: 200000, output: 0 } } } },
    })
    expect(lookup("openrouter/anthropic/claude-test")).toEqual({ context: 200000, output: undefined })
    expect(lookup("unknown/model")).toBeUndefined()
  })
})

describe("normalizeBaseURL", () => {
  test("adds http, strips /models and adds /v1 to a bare root", () => {
    expect(ProviderDiscovery.normalizeBaseURL("localhost:20128")).toBe("http://localhost:20128/v1")
    expect(ProviderDiscovery.normalizeBaseURL("127.0.0.1:20128")).toBe("http://127.0.0.1:20128/v1")
    expect(ProviderDiscovery.normalizeBaseURL("http://127.0.0.1:20128/v1/models/")).toBe("http://127.0.0.1:20128/v1")
    expect(ProviderDiscovery.normalizeBaseURL("https://router.example/")).toBe("https://router.example/v1")
    expect(ProviderDiscovery.normalizeBaseURL("https://router.example/api")).toBe("https://router.example/api")
  })

  test("defaults a scheme-less public host to https and keeps http for local hosts", () => {
    for (const [input, expected] of [
      ["api.together.xyz", "https://api.together.xyz/v1"],
      ["8.8.8.8:8000/v1", "https://8.8.8.8:8000/v1"],
      ["172.32.0.1/v1", "https://172.32.0.1/v1"],
      ["[2001:db8::1]:8000", "https://[2001:db8::1]:8000/v1"],
      ["localhost:11434", "http://localhost:11434/v1"],
      ["gpu.localhost:8000", "http://gpu.localhost:8000/v1"],
      ["llm.local:1234/v1", "http://llm.local:1234/v1"],
      ["10.1.2.3:8000", "http://10.1.2.3:8000/v1"],
      ["172.16.0.1:8000", "http://172.16.0.1:8000/v1"],
      ["192.168.1.20:8000", "http://192.168.1.20:8000/v1"],
      ["[::1]:8000", "http://[::1]:8000/v1"],
      ["[fd12:3456::1]:8000", "http://[fd12:3456::1]:8000/v1"],
      ["vllm:8000", "http://vllm:8000/v1"],
      ["http://api.example.com/v1", "http://api.example.com/v1"],
    ]) {
      expect(ProviderDiscovery.normalizeBaseURL(input)).toBe(expected)
    }
  })
})

it.effect("requests the models endpoint for scheme-less, /models and bare-root URLs", () =>
  Effect.gen(function* () {
    const paths: string[] = []
    const server = yield* serve((request) => {
      paths.push(new URL(request.url).pathname)
      return Response.json({ data: [{ id: "combo" }] })
    })
    const http = yield* HttpClient.HttpClient
    const expected = `${server.url}v1`
    for (const baseURL of [server.url.href.replace(/^http:\/\//, ""), `${server.url}v1/models`, server.url.href]) {
      const result = yield* ProviderDiscovery.discover(http, { baseURL, apiKey: "test" })
      expect(result.baseURL).toBe(expected)
    }
    expect(paths).toEqual(["/v1/models", "/v1/models", "/v1/models"])
  }),
)

it.effect("refuses model lists over the byte cap, declared or streamed", () =>
  Effect.gen(function* () {
    const big = JSON.stringify({ data: [{ id: "x".repeat(2048) }] })
    const declared = yield* serve(() => new Response(big, { headers: { "content-type": "application/json" } }))
    const streamed = yield* serve(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 4; index++) controller.enqueue(new TextEncoder().encode(" ".repeat(600)))
              controller.close()
            },
          }),
        ),
    )
    const http = yield* HttpClient.HttpClient
    for (const server of [declared, streamed]) {
      const error = yield* ProviderDiscovery.discover(
        http,
        { baseURL: `${server.url}v1`, apiKey: "test" },
        { maxBytes: 1024 },
      ).pipe(Effect.flip)
      expect(error.message).toContain("too large")
    }
  }),
)

for (const scenario of [
  { status: 401, body: "secret-test-key", message: "refused this API key" },
  { status: 403, body: "secret-test-key", message: "refused this API key" },
  { status: 404, body: "not found", message: "HTTP 404" },
  { status: 500, body: "internal error", message: "HTTP 500" },
  { status: 200, body: "<html>dashboard</html>", message: "invalid model list" },
  { status: 200, body: JSON.stringify({ data: [{ id: 123 }] }), message: "invalid model list" },
  { status: 200, body: JSON.stringify({ data: [] }), message: "No models are available" },
]) {
  it.effect(`reports ${scenario.status} ${scenario.message} without echoing upstream bodies`, () =>
    Effect.gen(function* () {
      const server = yield* serve(() => new Response(scenario.body, { status: scenario.status }))
      const http = yield* HttpClient.HttpClient
      const error = yield* ProviderDiscovery.discover(http, {
        baseURL: `${server.url}v1`,
        apiKey: "secret-test-key",
      }).pipe(Effect.flip)
      expect(error.message).toContain(scenario.message)
      expect(error.message).not.toContain("secret-test-key")
    }),
  )
}

it.effect("reports an unreachable endpoint without echoing the key", () =>
  Effect.gen(function* () {
    const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    const baseURL = `${closed.url}v1`
    yield* Effect.promise(() => closed.stop(true))
    const http = yield* HttpClient.HttpClient
    const error = yield* ProviderDiscovery.discover(http, { baseURL, apiKey: "secret-test-key" }).pipe(Effect.flip)
    expect(error.message).toContain("Cannot reach the provider")
    expect(error.message).not.toContain("secret-test-key")
  }),
)

it.effect("does not forward the key when the catalog redirects to another origin", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = []
    const other = yield* serve((request) => {
      seen.push(request.headers.get("authorization"))
      return Response.json({ data: [{ id: "redirected" }] })
    })
    const router = yield* serve(() => Response.redirect(`${other.url}v1/models`, 302))
    const http = yield* HttpClient.HttpClient
    yield* ProviderDiscovery.discover(http, { baseURL: `${router.url}v1`, apiKey: "secret-test-key" }).pipe(
      Effect.ignore,
    )
    expect(seen.every((auth) => !auth?.includes("secret-test-key"))).toBe(true)
  }),
)

it.effect("rejects invalid endpoints and credentials before making requests", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    for (const baseURL of [
      "http://",
      "ftp://router/v1",
      "file:///tmp/key",
      "http://user:pass@localhost/v1",
      "http://localhost/v1?key=secret",
      "http://localhost/v1#fragment",
    ]) {
      const error = yield* ProviderDiscovery.discover(http, { baseURL, apiKey: "test" }).pipe(Effect.flip)
      expect(error.message).toBe("Use an HTTP or HTTPS API URL without credentials, query or fragment.")
    }
    for (const apiKey of ["", "  "]) {
      const error = yield* ProviderDiscovery.discover(http, { baseURL: "http://127.0.0.1:1/v1", apiKey }).pipe(
        Effect.flip,
      )
      expect(error.message).toContain("Enter the API key")
    }
    for (const apiKey of ["key\r\nheader: value", "clé-secrète", "key with space"]) {
      const error = yield* ProviderDiscovery.discover(http, { baseURL: "http://127.0.0.1:1/v1", apiKey }).pipe(
        Effect.flip,
      )
      expect(error.message).toContain("invalid characters")
    }
  }),
)

it.live("keeps what a router says about each model beyond its limits", () =>
  Effect.gen(function* () {
    const server = yield* serve(() =>
      Response.json({
        data: [
          {
            id: "fast",
            owned_by: "combo",
            strategy: "fallback",
            thinking_levels: ["none", "low", "high"],
            capabilities: { tools: true, contextWindow: 200000 },
            context_length: 200000,
            max_completion_tokens: 32000,
          },
          { id: "cc/claude", owned_by: "cc", thinking_levels: ["low", "high", "low", 3] },
          { id: "combo-only", owned_by: "combo" },
          { id: "plain", owned_by: "openai" },
        ],
      }),
    )
    const http = yield* HttpClient.HttpClient
    const result = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1`, apiKey: "test" })
    const router = Object.fromEntries(result.models.map((model) => [model.id, model.router]))
    expect(router).toEqual({
      fast: {
        owned_by: "combo",
        strategy: "fallback",
        thinking_levels: ["none", "low", "high"],
        capabilities: { tools: true, contextWindow: 200000 },
      },
      "cc/claude": { owned_by: "cc", thinking_levels: ["low", "high"] },
      "combo-only": { owned_by: "combo" },
      plain: undefined,
    })
    expect(result.models.find((model) => model.id === "fast")?.limit).toEqual({ context: 200000, output: 32000 })
  }),
)

test("keeps RedRouter's upstream provider, earlier ids, collapsed variants and remote hop per model", () => {
  expect(
    ProviderDiscovery.routerInfo({
      id: "codex/gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      owned_by: "codex",
      provider: {
        id: "codex",
        slug: "codex",
        prefix: "cx",
        name: "OpenAI Codex",
        category: "subscription",
        subscription: true,
      },
      aliases: ["cx/gpt-5.6-sol", "codex/gpt-5.6-sol", "", 7],
      parameters: { modes: ["review"], thinking_levels: ["low", "high"] },
      variants: [
        { id: "codex/gpt-5.6-sol(high)", name: "GPT-5.6 Sol (high)", level: "high" },
        { id: "codex/gpt-5.6-sol-review", mode: "review", aliases: ["cx/gpt-5.6-sol-review"] },
        { name: "no id" },
      ],
      via: "red-router",
    }),
  ).toEqual({
    owned_by: "codex",
    thinking_levels: ["low", "high"],
    parameters: { modes: ["review"], thinking_levels: ["low", "high"] },
    provider: {
      id: "codex",
      slug: "codex",
      prefix: "cx",
      name: "OpenAI Codex",
      category: "subscription",
      subscription: true,
    },
    aliases: ["cx/gpt-5.6-sol"],
    variants: [
      { id: "codex/gpt-5.6-sol(high)", name: "GPT-5.6 Sol (high)", level: "high" },
      { id: "codex/gpt-5.6-sol-review", mode: "review", aliases: ["cx/gpt-5.6-sol-review"] },
    ],
    via: "red-router",
  })
  // A provider block without an id says nothing; a missing name falls back to the slug.
  expect(ProviderDiscovery.routerInfo({ id: "x", provider: { name: "Nameless" } })).toBeUndefined()
  expect(ProviderDiscovery.routerInfo({ id: "x", provider: { id: "kilo-code", slug: "kilo-code" } })).toEqual({
    provider: { id: "kilo-code", slug: "kilo-code", name: "kilo-code" },
  })
})

test("keeps a combo's parameter basis and each member's parameters", () => {
  expect(
    ProviderDiscovery.routerInfo({
      id: "fast",
      owned_by: "combo",
      strategy: "fallback",
      parameters: { context_length: 1000000, max_completion_tokens: 64000 },
      parameters_basis: "lead",
      parameters_strict: { context_length: 200000 },
      members: ["cc/lead", "cc/other"],
      member_parameters: [
        { id: "cc/lead", parameters: { context_length: 1000000, max_completion_tokens: 64000 } },
        { id: "cc/other", parameters: { context_length: 200000, thinking_levels: ["low"], forced_tool_choice: false } },
        { id: "cc/unknown", parameters: "none" },
        { parameters: { context_length: 1 } },
      ],
    }),
  ).toEqual({
    owned_by: "combo",
    strategy: "fallback",
    parameters: { context_length: 1000000, max_completion_tokens: 64000 },
    parameters_basis: "lead",
    members: ["cc/lead", "cc/other"],
    member_parameters: [
      { id: "cc/lead", parameters: { context_length: 1000000, max_completion_tokens: 64000 } },
      { id: "cc/other", parameters: { context_length: 200000, thinking_levels: ["low"], forced_tool_choice: false } },
      { id: "cc/unknown" },
    ],
  })
  // A router before per-member parameters, or a basis it may add later, reads as before.
  expect(
    ProviderDiscovery.routerInfo({
      id: "fast",
      owned_by: "combo",
      parameters_basis: "newest",
      members: ["cc/lead"],
    }),
  ).toEqual({ owned_by: "combo", members: ["cc/lead"] })
})

it.live("reads a fallback combo's lead parameters and every member's from the model list", () =>
  Effect.gen(function* () {
    const server = yield* serve(() =>
      Response.json({
        data: [
          {
            id: "fast",
            owned_by: "combo",
            strategy: "fallback",
            members: ["cc/lead", "cc/other"],
            parameters: { context_length: 1000000, max_completion_tokens: 64000 },
            parameters_basis: "lead",
            member_parameters: [
              { id: "cc/lead", parameters: { context_length: 1000000, max_completion_tokens: 64000 } },
              { id: "cc/other", parameters: { context_length: 200000, max_completion_tokens: 32000 } },
            ],
          },
        ],
      }),
    )
    const http = yield* HttpClient.HttpClient
    const result = yield* ProviderDiscovery.discover(http, { baseURL: `${server.url}v1`, apiKey: "test" })
    const fast = result.models.find((model) => model.id === "fast")
    // The lead's limits are the combo's: a member that serves instead is followed per session.
    expect(fast?.limit).toEqual({ context: 1000000, output: 64000 })
    expect(fast?.router?.parameters_basis).toBe("lead")
    expect(fast?.router?.member_parameters).toEqual([
      { id: "cc/lead", parameters: { context_length: 1000000, max_completion_tokens: 64000 } },
      { id: "cc/other", parameters: { context_length: 200000, max_completion_tokens: 32000 } },
    ])
  }),
)
