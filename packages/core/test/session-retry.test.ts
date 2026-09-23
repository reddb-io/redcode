import { describe, expect, test } from "bun:test"
import {
  ContentPolicyReason,
  HttpContext,
  HttpRequestDetails,
  HttpResponseDetails,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  QuotaExceededReason,
  RateLimitReason,
  TransportReason,
  type LLMErrorReason,
} from "@reddb-io/redcode-llm"
import { SessionRetry } from "@reddb-io/redcode-core/session/retry"

const failure = (reason: LLMErrorReason) => new LLMError({ module: "test", method: "stream", reason })

const http = (status: number, body: string) =>
  new HttpContext({
    request: new HttpRequestDetails({ method: "POST", url: "https://provider.test/v1", headers: {} }),
    response: new HttpResponseDetails({ status, headers: {} }),
    body,
  })

describe("SessionRetry over LLMError (v2 runner)", () => {
  test("never retries a context overflow", () => {
    expect(
      SessionRetry.retryableLLM(
        failure(new InvalidRequestReason({ message: "prompt is too long", classification: "context-overflow" })),
      ),
    ).toBeUndefined()
  })

  test("retries rate limits, server errors and transient transport failures, and nothing else", () => {
    expect(SessionRetry.retryableLLM(failure(new RateLimitReason({ message: "Too many requests" })))).toEqual({
      message: "Too many requests",
    })
    expect(
      SessionRetry.retryableLLM(failure(new ProviderInternalReason({ message: "Overloaded", status: 529 }))),
    ).toEqual({ message: "Provider is overloaded" })
    expect(SessionRetry.retryableLLM(failure(new TransportReason({ message: "fetch failed" })))).toBeDefined()
    expect(SessionRetry.retryableLLM(failure(new TransportReason({ message: "Provider unavailable" })))).toBeUndefined()
    expect(
      SessionRetry.retryableLLM(failure(new InvalidRequestReason({ message: "Bad parameter" }))),
    ).toBeUndefined()
  })

  test("never retries an exhausted account or a content-policy refusal, whatever the message says", () => {
    expect(
      SessionRetry.retryableLLM(
        failure(new QuotaExceededReason({ message: "Provider request failed with HTTP 429: Rate limit exceeded" })),
      ),
    ).toBeUndefined()
    expect(
      SessionRetry.retryableLLM(failure(new ContentPolicyReason({ message: "server_error: blocked, try again" }))),
    ).toBeUndefined()
    // A rate-limit reason whose body names a gateway account cap is a quota, not a throttle.
    expect(
      SessionRetry.retryableLLM(
        failure(
          new RateLimitReason({
            message: "Rate limit exceeded. Please try again later.",
            http: http(429, JSON.stringify({ type: "error", error: { type: "FreeUsageLimitError" } })),
          }),
        ),
      ),
    ).toBeUndefined()
  })

  test("does not let substituted server codes make a 4xx rejection retryable", () => {
    const body = JSON.stringify({
      error: { type: "server_error", message: "Upstream request failed: Model is unavailable." },
    })
    expect(
      SessionRetry.retryableLLM(
        failure(
          new InvalidRequestReason({
            message: `Provider request failed with HTTP 400: ${body}`,
            http: http(400, body),
          }),
        ),
      ),
    ).toBeUndefined()
    // A transport failure behind a 4xx still says nothing about the request itself.
    expect(
      SessionRetry.retryableLLM(
        failure(
          new InvalidRequestReason({ message: "upstream connect error", http: http(400, "upstream connect error") }),
        ),
      ),
    ).toBeDefined()
  })

  test("honours retry-after, otherwise backs off exponentially under the legacy cap", () => {
    expect(SessionRetry.delayLLM(1, failure(new RateLimitReason({ message: "slow", retryAfterMs: 1_500 })))).toBe(
      1_500,
    )
    const transient = failure(new TransportReason({ message: "fetch failed" }))
    expect(SessionRetry.delayLLM(1, transient, 0)).toBe(2_000)
    expect(SessionRetry.delayLLM(3, transient, 0)).toBe(8_000)
    expect(SessionRetry.delayLLM(10, transient, 0)).toBe(SessionRetry.RETRY_MAX_DELAY_NO_HEADERS)
    expect(SessionRetry.delayLLM(1, transient, 1)).toBe(2_500)
    expect(SessionRetry.RETRY_MAX_RETRIES).toBe(5)
  })

  test("caps an excessive provider retry-after at fifteen minutes", () => {
    expect(SessionRetry.delayLLM(1, failure(new RateLimitReason({ message: "slow", retryAfterMs: 3_600_000 })))).toBe(
      900_000,
    )
    expect(
      SessionRetry.delayLLM(
        1,
        failure(new ProviderInternalReason({ message: "busy", status: 503, retryAfterMs: 899_999 })),
      ),
    ).toBe(899_999)
  })
})
