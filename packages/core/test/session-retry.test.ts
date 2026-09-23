import { describe, expect, test } from "bun:test"
import {
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
  TransportReason,
  type LLMErrorReason,
} from "@reddb-io/redcode-llm"
import { SessionRetry } from "@reddb-io/redcode-core/session/retry"

const failure = (reason: LLMErrorReason) => new LLMError({ module: "test", method: "stream", reason })

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
