import { describe, expect, test } from "bun:test"
import {
  contextOverflowNumbers,
  isContentPolicyFailure,
  isContextOverflow,
  isContextOverflowBody,
  isContextOverflowCode,
  isQuotaFailure,
} from "../src"

describe("provider error classification", () => {
  test("classifies provider token limit messages as context overflow", () => {
    const messages = [
      "tokens in request more than max tokens allowed",
      '{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
      "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
      "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      "Range of input length should be [1, 129024]",
      "Too many tokens",
      "Token limit exceeded",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })
})

describe("provider error bodies", () => {
  const upstream = "input length 145210 exceeds the maximum allowed input length of 131072 tokens"

  test("classifies the OpenAI-compatible envelope routers forward", () => {
    const body = JSON.stringify({
      error: { message: upstream, type: "invalid_request_error", code: "invalid_request" },
    })
    expect(isContextOverflowBody(body)).toBe(true)
    expect(isContextOverflowBody(`Provider request failed with HTTP 400: ${body}`)).toBe(true)
  })

  test("classifies a router envelope whose upstream message sits in error.metadata.raw", () => {
    const body = JSON.stringify({
      error: {
        message: "Provider returned error",
        code: 400,
        metadata: {
          raw: JSON.stringify({ error: { message: upstream, type: "invalid_request_error" } }),
          provider_name: "Novita",
        },
      },
    })
    expect(isContextOverflow("Provider returned error")).toBe(false)
    expect(isContextOverflowBody(body)).toBe(true)
  })

  test("classifies by error code or type when the message says nothing", () => {
    for (const code of [
      "context_length_exceeded",
      "too_many_tokens",
      "model_context_window_exceeded",
      "max_prompt_tokens_exceeded",
      "input_too_long",
    ]) {
      expect(isContextOverflowCode(code)).toBe(true)
      expect(isContextOverflowBody(JSON.stringify({ error: { message: "Bad request", code } }))).toBe(true)
      expect(isContextOverflowBody(JSON.stringify({ error: { message: "Bad request", type: code } }))).toBe(true)
    }
    expect(isContextOverflowCode("invalid_request_error")).toBe(false)
    expect(isContextOverflowBody(JSON.stringify({ error: { message: "Bad request", code: "invalid_api_key" } }))).toBe(
      false,
    )
    expect(isContextOverflowBody("")).toBe(false)
    expect(isContextOverflowBody(undefined)).toBe(false)
  })
})

describe("contextOverflowNumbers", () => {
  test("reads the limit and count out of the messages providers send", () => {
    expect(
      contextOverflowNumbers("Input length 131393 exceeds the maximum allowed input length of 131040 tokens."),
    ).toEqual({
      counted: 131_393,
      limit: 131_040,
    })
    expect(contextOverflowNumbers("prompt is too long: 213462 tokens > 200000 maximum")).toEqual({
      counted: 213_462,
      limit: 200_000,
    })
    expect(
      contextOverflowNumbers(
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 130500 tokens (120500 in the messages, 10000 in the completion). Please reduce the length of the messages or completion.",
      ),
    ).toEqual({ limit: 128_000, counted: 120_500, output: 10_000, includesOutput: true })
    expect(
      contextOverflowNumbers(
        "This model's maximum context length is 128000 tokens. However, you requested 130500 tokens.",
      ),
    ).toEqual({ limit: 128_000, counted: 130_500, includesOutput: true })
    expect(
      contextOverflowNumbers(
        'This model\'s maximum context length is 1048576 tokens, but the request resolved to 1064559 input tokens (including image/vision expansion). Reduce the input length, image resolution, or the number of images."',
      ),
    ).toEqual({ limit: 1_048_576, counted: 1_064_559 })
    expect(
      contextOverflowNumbers(
        "Requested token count exceeds the model's maximum context length of 131072 tokens. You requested a total of 140000 tokens: 130000 tokens from the input messages and 10000 tokens for the completion.",
      ),
    ).toEqual({ limit: 131_072, counted: 130_000, output: 10_000, includesOutput: true })
    expect(contextOverflowNumbers("input tokens 120000 + max_tokens 8192 > 128000")).toEqual({
      counted: 120_000,
      output: 8_192,
      limit: 128_000,
      includesOutput: true,
    })
    expect(
      contextOverflowNumbers("The input (516,368 tokens) is longer than the model's context length (262,144 tokens)."),
    ).toEqual({ counted: 516_368, limit: 262_144 })
    expect(contextOverflowNumbers("Input length (265330) exceeds model's maximum context length (262144).")).toEqual({
      counted: 265_330,
      limit: 262_144,
    })
    expect(
      contextOverflowNumbers("Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens"),
    ).toEqual({ counted: 5_958_968, limit: 256_000 })
    expect(
      contextOverflowNumbers("The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"),
    ).toEqual({ counted: 1_196_265, limit: 1_048_575 })
    expect(contextOverflowNumbers("context length is only 8192 tokens")).toEqual({ limit: 8_192, includesOutput: true })
    // Localised thousands separators; a decimal is not a count.
    expect(
      contextOverflowNumbers("Input length 145.210 exceeds the maximum allowed input length of 131.072 tokens."),
    ).toEqual({
      counted: 145_210,
      limit: 131_072,
    })
    expect(
      contextOverflowNumbers("Input length 145 210 exceeds the maximum allowed input length of 131 072 tokens."),
    ).toEqual({
      counted: 145_210,
      limit: 131_072,
    })
    expect(
      contextOverflowNumbers("Input length 145.21 exceeds the maximum allowed input length of 131.07 tokens."),
    ).toBeUndefined()
    expect(contextOverflowNumbers("too large for model with 32768 maximum context length")).toEqual({
      limit: 32_768,
      includesOutput: true,
    })
  })

  test("finds the numbers inside a router envelope and gives up without any", () => {
    const body = JSON.stringify({
      error: {
        message: "Provider returned error",
        metadata: {
          raw: JSON.stringify({
            error: { message: "input length 145210 exceeds the maximum allowed input length of 131072 tokens" },
          }),
        },
      },
    })
    expect(contextOverflowNumbers(body)).toEqual({ counted: 145_210, limit: 131_072 })
    expect(contextOverflowNumbers("request entity too large")).toBeUndefined()
    expect(contextOverflowNumbers("Too many tokens")).toBeUndefined()
    // These classify a refusal but teach no limit: the same words announce other limits.
    expect(isContextOverflow("number of images exceeds the limit of 20")).toBe(true)
    expect(contextOverflowNumbers("number of images exceeds the limit of 20")).toBeUndefined()
    expect(contextOverflowNumbers("number of tools exceeds the limit of 128")).toBeUndefined()
    expect(contextOverflowNumbers("maximum prompt length is 4000")).toBeUndefined()
    // Arithmetic without max_tokens says nothing.
    expect(contextOverflowNumbers("3 + 4 > 5 items")).toBeUndefined()
    expect(isContextOverflow("3 + 4 > 5 items")).toBe(false)
  })

  test("classifies 402 and gateway account limits as exhausted quota", () => {
    const typed = (type: string, message: string) => ({ type: "error", error: { type, message } })
    const cases: ReadonlyArray<{ status?: number; body?: unknown; message?: string }> = [
      { status: 402, message: "Payment Required" },
      { status: 402, body: '{"error":{"code":402,"message":"This request requires more credits"}}' },
      {
        status: 429,
        body: JSON.stringify(typed("FreeUsageLimitError", "Rate limit exceeded. Please try again later.")),
      },
      { status: 429, body: JSON.stringify(typed("GoUsageLimitError", "Go usage limit exceeded")) },
      { status: 402, body: typed("CreditLimitExceeded", "Credit limit exceeded.") },
      { status: 429, body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' },
      { status: 429, message: "Account budget exceeded" },
      { status: 429, message: "Insufficient credits to complete this request" },
      // Mid-stream errors carry no status; the code alone decides.
      { body: { type: "error", error: { type: "usage_limit_reached", message: "You have hit your usage limit" } } },
      // A router forwards the upstream error in its metadata.
      {
        status: 403,
        body: { error: { code: 403, metadata: { raw: JSON.stringify({ error: { code: "billing_error" } }) } } },
      },
      // OpenCode Zen keeps an upstream code it does not forward as a label.
      { status: 400, message: "Upstream request failed: [insufficient_quota] quota exhausted" },
    ]
    expect(cases.map(isQuotaFailure)).toEqual(Array(cases.length).fill(true))
  })

  test("keeps throttles and other client errors out of quota", () => {
    const cases: ReadonlyArray<{ status?: number; body?: unknown; message?: string }> = [
      { status: 429, message: "Rate limit exceeded, please retry after 30 seconds." },
      { status: 429, body: '{"error":{"type":"rate_limit_error","message":"Too many requests"}}' },
      // Quota wording only counts on a 429, where throttles and account caps share a status.
      { status: 400, message: "usage limit for images is 20" },
      { status: 400, body: '{"error":{"type":"invalid_request_error","message":"Bad parameter"}}' },
      { status: 404, message: "Not Found" },
      { body: "not-json" },
    ]
    expect(cases.map(isQuotaFailure)).toEqual(Array(cases.length).fill(false))
  })

  test("classifies content policy refusals by provider codes", () => {
    expect(
      [
        { body: { error: { code: "content_filter", innererror: { code: "ResponsibleAIPolicyViolation" } } } },
        { body: '{"error":{"code":400,"metadata":{"error_type":"content_policy_violation"}}}' },
        { body: { error: { code: "image_content_policy_violation" } } },
        { message: "Upstream request failed: [content_filter] blocked" },
      ].map(isContentPolicyFailure),
    ).toEqual([true, true, true, true])
    expect(isContentPolicyFailure({ body: '{"error":{"code":"invalid_prompt"}}' })).toBe(false)
    expect(isContentPolicyFailure({ status: 402, message: "Payment Required" })).toBe(false)
  })
})
