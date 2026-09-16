import { describe, expect, test } from "bun:test"
import {
  connectionProblem,
  isNineRouterDefaultURL,
  keyProblem,
  normalizeBaseURL,
  normalizeProviderID,
  parseManualModels,
  suggestName,
  suggestProviderID,
} from "../../src/util/openai-compatible"

describe("normalizeBaseURL", () => {
  test("adds http when the scheme is missing", () => {
    expect(normalizeBaseURL("localhost:20128")).toBe("http://localhost:20128/v1")
    expect(normalizeBaseURL(" 127.0.0.1:20128 ")).toBe("http://127.0.0.1:20128/v1")
  })

  test("strips a trailing /models", () => {
    expect(normalizeBaseURL("http://127.0.0.1:20128/v1/models/")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeBaseURL("https://router.example/api/v1/models")).toBe("https://router.example/api/v1")
  })

  test("adds /v1 to a bare root and keeps other paths", () => {
    expect(normalizeBaseURL("http://127.0.0.1:20128")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeBaseURL("http://127.0.0.1:20128/")).toBe("http://127.0.0.1:20128/v1")
    expect(normalizeBaseURL("http://router.example/api///")).toBe("http://router.example/api")
  })

  test("rejects non-HTTP URLs and URLs with credentials, query or fragment", () => {
    for (const value of [
      "",
      "http://",
      "ftp://router/v1",
      "file:///tmp/key",
      "http://user:pass@router/v1",
      "http://router/v1?key=secret",
      "http://router/v1#fragment",
    ]) {
      expect(normalizeBaseURL(value)).toBeUndefined()
    }
  })
})

describe("provider ids and names", () => {
  test("normalizes and validates ids like the server", () => {
    expect(normalizeProviderID("  custom-provider  ")).toBe("custom-provider")
    expect(normalizeProviderID("custom_provider")).toBe("custom_provider")
    expect(normalizeProviderID("@ai-sdk/custom-provider")).toBe("custom-provider")
    expect(normalizeProviderID("-custom-provider")).toBeUndefined()
    expect(normalizeProviderID("Custom Provider")).toBeUndefined()
    expect(normalizeProviderID("x".repeat(65))).toBeUndefined()
  })

  test("suggests an id from the host, avoiding ids already in use", () => {
    expect(suggestProviderID("https://api.together.xyz/v1")).toBe("together")
    expect(suggestProviderID("https://llm.corp.example.co/v1")).toBe("example")
    expect(suggestProviderID("localhost:11434")).toBe("openai-compatible")
    expect(suggestProviderID("http://10.0.0.5:8000/v1")).toBe("openai-compatible")
    expect(suggestProviderID("http://[::1]:8000/v1")).toBe("openai-compatible")
    expect(suggestProviderID("https://openrouter.ai/api/v1", (id) => id === "openrouter")).toBe("openrouter-2")
  })

  test("derives a display name from the id", () => {
    expect(suggestName("my-gateway_eu")).toBe("My Gateway Eu")
  })

  test("recognizes 9Router's default addresses", () => {
    expect(isNineRouterDefaultURL("http://127.0.0.1:20128/v1")).toBe(true)
    expect(isNineRouterDefaultURL("localhost:20128")).toBe(true)
    expect(isNineRouterDefaultURL("https://gateway.example.com/v1")).toBe(false)
  })
})

describe("keyProblem", () => {
  test("accepts keys, references and no key", () => {
    for (const value of ["", "sk-test", "{env:MY_KEY}", " {env:_KEY_2} "]) expect(keyProblem(value)).toBeUndefined()
  })

  test("rejects partial references and invalid characters", () => {
    expect(keyProblem("Bearer {env:KEY}")).toContain("on its own")
    expect(keyProblem("{env:MY-KEY}")).toContain("on its own")
    expect(keyProblem("clé")).toContain("invalid characters")
  })
})

describe("parseManualModels", () => {
  test("reads ids with optional context sizes", () => {
    expect(parseManualModels("llama3.1:8b 128k, qwen2.5-coder\nbig 1.5m，small 32000")).toEqual({
      models: [
        { id: "llama3.1:8b", context: 128000 },
        { id: "qwen2.5-coder" },
        { id: "big", context: 1500000 },
        { id: "small", context: 32000 },
      ],
    })
  })

  test("keeps the last entry for a repeated id", () => {
    expect(parseManualModels("m, m 8k")).toEqual({ models: [{ id: "m", context: 8000 }] })
  })

  test("explains what is wrong", () => {
    expect(parseManualModels(" , ")).toEqual({ error: "Enter at least one model id." })
    expect(parseManualModels("model lots")).toMatchObject({ error: expect.stringContaining("not a context size") })
    expect(parseManualModels("a b c")).toMatchObject({ error: expect.stringContaining("not a model id") })
    expect(parseManualModels("__proto__")).toMatchObject({ error: expect.stringContaining("not a model id") })
  })
})

describe("connectionProblem", () => {
  const base = { providerID: "gateway", name: "Gateway", baseURL: "http://127.0.0.1:20128/v1" }
  const providers = [{ id: "gateway", models: { combo: {} } }]

  test("accepts the saved connection when URLs differ only in normalization", () => {
    expect(connectionProblem({ ...base, options: { baseURL: "127.0.0.1:20128/v1/" }, providers })).toBeUndefined()
  })

  test("reports an apiKey override only when the key went to the credential store", () => {
    const options = { baseURL: base.baseURL, apiKey: "resolved" }
    expect(connectionProblem({ ...base, options, providers })).toContain("provider.options.apiKey")
    expect(connectionProblem({ ...base, credential: "reference", options, providers })).toBeUndefined()
    expect(connectionProblem({ ...base, credential: "kept", options, providers })).toBeUndefined()
  })

  test("reports a project baseURL that points elsewhere", () => {
    expect(connectionProblem({ ...base, options: { baseURL: "http://10.0.0.2:20128/v1" }, providers })).toContain(
      "Gateway was saved, but an existing provider.options.apiKey or project baseURL overrides",
    )
  })

  test("reports filters that hide every model", () => {
    for (const hidden of [[], [{ id: "gateway", models: {} }], [{ id: "other", models: { combo: {} } }]]) {
      expect(connectionProblem({ ...base, providers: hidden })).toContain("no models are enabled")
    }
  })
})
