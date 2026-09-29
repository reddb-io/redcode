import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  discover,
  normalizeBaseURL,
  parseEndpoint,
  parseHeaders,
  providerConfig,
} from "@opencode/core/plugin/provider/openai-compatible"

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
    return new Response("missing", { status: 404 })
  },
})
afterAll(() => server.stop(true))

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

  test("reports a rejected key even when models were entered", async () => {
    const error = await Effect.runPromise(
      Effect.flip(discover(endpoint({ baseURL: `${base}/v1`, models: "alpha" }), "sk-bad")),
    )
    expect(error.message).toStartWith("The endpoint rejected the API key (HTTP 401")
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
