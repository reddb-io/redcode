import { describe, expect, test } from "bun:test"
import { AIError, AuthenticationError, HttpContext, TransportError } from "@opencode/ai"
import { ProviderFailure } from "@opencode/core/session/provider-failure"
import { toSessionError } from "@opencode/core/session/to-session-error"

const route = { provider: "openai", model: "gpt-6" }

describe("ProviderFailure.redactURL", () => {
  test("keeps scheme, host, port and path", () => {
    expect(ProviderFailure.redactURL("https://api.example.com:8443/v1/responses")).toBe(
      "https://api.example.com:8443/v1/responses",
    )
  })

  test("drops credentials, the query string and the fragment", () => {
    const redacted = ProviderFailure.redactURL(
      "https://user:secret@api.example.com/v1/chat?key=sk-123&api-version=1#frag",
    )
    expect(redacted).toBe("https://api.example.com/v1/chat")
    expect(redacted).not.toContain("secret")
    expect(redacted).not.toContain("sk-123")
  })

  test("withholds everything after the query of an unparseable URL", () => {
    expect(ProviderFailure.redactURL("not a url?token=abc")).toBe("not a url")
    expect(ProviderFailure.redactURL("?token=abc")).not.toContain("abc")
  })
})

describe("ProviderFailure.describe", () => {
  test("names provider, model, request and status after the message", () => {
    expect(
      ProviderFailure.describe({
        message: "Connection refused",
        provider: "openai",
        model: "gpt-6",
        url: "https://api.example.com/v1/responses",
        status: 502,
      }),
    ).toBe("Connection refused (openai/gpt-6, https://api.example.com/v1/responses, HTTP 502)")
  })

  test("is the bare message when there is no context", () => {
    expect(ProviderFailure.describe({ message: "Step interrupted" })).toBe("Step interrupted")
  })
})

describe("toSessionError with a route", () => {
  test("records provider, model and the redacted URL of a transport failure", () => {
    const error = toSessionError(
      new AIError({
        reason: new TransportError({
          message: "Connection refused",
          transport: "http",
          operation: "request",
          url: "https://user:pw@api.example.com/v1/responses?key=secret",
        }),
      }),
      route,
    )
    expect(error).toEqual({
      type: "provider.transport",
      message: "Connection refused",
      provider: "openai",
      model: "gpt-6",
      url: "https://api.example.com/v1/responses",
    })
  })

  test("names the route but not the URL when the host answered", () => {
    expect(
      toSessionError(
        new AIError({
          reason: new AuthenticationError({
            message: "Invalid key",
            http: new HttpContext({ url: "https://api.example.com/v1?key=secret", status: 401, headers: {} }),
          }),
        }),
        route,
      ),
    ).toEqual({ type: "provider.auth", message: "Invalid key", status: 401, provider: "openai", model: "gpt-6" })
  })
})
