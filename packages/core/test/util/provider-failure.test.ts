import { describe, expect, test } from "bun:test"
import { ProviderFailure } from "../../src/util/provider-failure"

// Verbatim record taken from the `message` table of a real failed session; the
// URL is what revealed the request had gone to an Anthropic path while an
// OpenAI-compatible provider was configured.
const RECORDED = {
  name: "APIError",
  data: {
    message: "404 Page not found",
    statusCode: 404,
    isRetryable: false,
    responseHeaders: {
      "minimax-request-id": "fdf4f50a92ec5a88f79125fedaa3ed3b",
      authorization: "Bearer sk-live-do-not-print-me",
    },
    responseBody: "404 page not found",
    metadata: {
      providerID: "minimax",
      modelID: "MiniMax-M3",
      url: "https://api.minimax.chat/v1/messages",
    },
  },
}

describe("ProviderFailure.describe", () => {
  test("turns the recorded failure into a diagnosable message", () => {
    expect(ProviderFailure.describe("404 Page not found", RECORDED)).toBe(
      [
        "404 Page not found",
        "  provider minimax/MiniMax-M3",
        "  request  https://api.minimax.chat/v1/messages",
        "  status   404",
      ].join("\n"),
    )
  })

  test("never echoes response headers, where bearer tokens live", () => {
    expect(ProviderFailure.describe("404 Page not found", RECORDED)).not.toContain("sk-live-do-not-print-me")
    expect(ProviderFailure.describe("404 Page not found", RECORDED)).not.toContain("authorization")
  })

  test("falls back to the caller's provider and model for records written before they were recorded", () => {
    const legacy = { name: "APIError", data: { message: "boom", metadata: { url: "https://api.acme.dev/v1/chat" } } }
    expect(ProviderFailure.describe("boom", legacy, { providerID: "acme", modelID: "acme-1" })).toContain(
      "provider acme/acme-1",
    )
  })

  test("prefers the recorded provider over the caller's fallback", () => {
    expect(ProviderFailure.describe("404 Page not found", RECORDED, { providerID: "wrong", modelID: "wrong" })).toContain(
      "provider minimax/MiniMax-M3",
    )
  })

  test("returns the message untouched when there is no transport context", () => {
    expect(ProviderFailure.describe("Aborted", { name: "MessageAbortedError", data: { message: "Aborted" } })).toBe(
      "Aborted",
    )
    expect(ProviderFailure.describe("nope", undefined)).toBe("nope")
    expect(ProviderFailure.describe("nope", "a string")).toBe("nope")
  })
})

describe("ProviderFailure.redactURL", () => {
  test("keeps scheme, host, port and path, which are the diagnosis", () => {
    expect(ProviderFailure.redactURL("https://api.minimax.chat:8443/v1/messages")).toBe(
      "https://api.minimax.chat:8443/v1/messages",
    )
  })

  test("redacts a key passed as a query parameter", () => {
    // Google's Generative Language API takes the API key this way.
    expect(ProviderFailure.redactURL("https://generativelanguage.googleapis.com/v1/models:generate?key=AIzaSyREAL")).toBe(
      `https://generativelanguage.googleapis.com/v1/models:generate?key=${ProviderFailure.REDACTED}`,
    )
  })

  test("redacts query values it has never seen, not just key-shaped names", () => {
    const redacted = ProviderFailure.redactURL("https://api.acme.dev/v1?wildcard=SECRET&sig=SECRET&token=SECRET")
    expect(redacted).not.toContain("SECRET")
  })

  test("redacts credentials in userinfo", () => {
    expect(ProviderFailure.redactURL("https://admin:hunter2@api.acme.dev/v1/chat")).toBe("https://api.acme.dev/v1/chat")
  })

  test("drops the fragment, which can carry a token", () => {
    expect(ProviderFailure.redactURL("https://api.acme.dev/v1/chat#access_token=SECRET")).toBe(
      "https://api.acme.dev/v1/chat",
    )
  })

  test("collapses a repeated credential parameter so no copy survives", () => {
    expect(ProviderFailure.redactURL("https://api.acme.dev/v1?key=SECRET&key=SECRET2")).not.toContain("SECRET")
  })

  test("keeps the allowlisted api-version, which is itself a diagnosis", () => {
    expect(
      ProviderFailure.redactURL("https://acme.openai.azure.com/openai/deployments/gpt/chat?api-version=2024-06-01"),
    ).toBe("https://acme.openai.azure.com/openai/deployments/gpt/chat?api-version=2024-06-01")
  })

  test("matches the allowlist case-insensitively", () => {
    expect(ProviderFailure.redactURL("https://api.acme.dev/v1?API-Version=2024-06-01")).toContain("2024-06-01")
  })

  test("withholds the query of an unparseable URL rather than guessing", () => {
    expect(ProviderFailure.redactURL("api.acme.dev/v1/chat?key=SECRET")).toBe(
      `api.acme.dev/v1/chat?${ProviderFailure.REDACTED}`,
    )
    expect(ProviderFailure.redactURL("?key=SECRET")).toBe(ProviderFailure.REDACTED)
    expect(ProviderFailure.redactURL("")).toBe(ProviderFailure.REDACTED)
  })

  test("no query value survives for any parameter name a provider might invent", () => {
    // The allowlist is the guarantee: an unknown name can never leak its value.
    const names = ["key", "api_key", "apikey", "access_token", "sig", "signature", "password", "x-goog-api-key", "zzz"]
    for (const name of names) {
      expect(ProviderFailure.redactURL(`https://api.acme.dev/v1?${name}=SUPERSECRET`)).not.toContain("SUPERSECRET")
    }
  })
})
