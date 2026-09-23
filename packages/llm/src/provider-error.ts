import { Option, Schema } from "effect"
import { LLMError, ProviderErrorEvent } from "./schema"

const patterns = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /range of input length should be/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /max_prompt_tokens_exceeded/i,
  /input_too_long|prompt_too_long|max_context_length_exceeded|context_window_exceeded/i,
  /[\d,]+\s*\+\s*max_tokens\s*[\d,]+\s*>\s*[\d,]+/i,
]

const exclusions = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i]

/**
 * Error codes providers and routers put in `error.code` (or `error.type`) for a request whose
 * input does not fit the model. Gateways forward the upstream code, so the list is shared by
 * every protocol.
 */
const codes = new Set([
  "context_length_exceeded",
  "too_many_tokens",
  "model_context_window_exceeded",
  "max_prompt_tokens_exceeded",
  "input_too_long",
  "prompt_too_long",
  "max_context_length_exceeded",
  "context_window_exceeded",
  "request_too_large",
])

export const isContextOverflowCode = (code: unknown) => typeof code === "string" && codes.has(code.trim().toLowerCase())

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) || /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message))

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * Whether an HTTP error body describes a context overflow: by its message, by the `error.code`
 * or `error.type` a provider or router sets, or by the upstream error a router forwards in
 * `error.metadata.raw`.
 */
export const isContextOverflowBody = (body: string | undefined): boolean => {
  if (!body) return false
  if (isContextOverflow(body)) return true
  try {
    const parsed = record(JSON.parse(body))
    const error = record(parsed?.error) ?? parsed
    if (!error) return false
    if (isContextOverflowCode(error.code) || isContextOverflowCode(error.type)) return true
    const raw = record(error.metadata)?.raw
    return typeof raw === "string" && isContextOverflowBody(raw)
  } catch {
    return false
  }
}

/**
 * Codes for an exhausted account: no quota, no credits, a spent budget or a free-tier cap. Gateways
 * such as OpenCode Zen report these as typed 429 or 402 errors that are not throttles, so waiting
 * and sending the request again does not help.
 */
const quotaCodes = new Set([
  "insufficient_quota",
  "usage_not_included",
  "billing_error",
  "usage_limit",
  "usage_limit_reached",
  "usage_limit_exceeded",
  "insufficient_credits",
  "gousagelimiterror",
  "freeusagelimiterror",
  "creditlimitexceeded",
])

// Only consulted on 429, where throttles and account caps share a status.
const quotaText =
  /insufficient[-_\s]?(?:quota|credits|funds|balance)|quota[-_\s]?exceeded|budget exceeded|usage[-_\s]?limit|credit limit|requires more credits|out of credits/i

/**
 * Codes for a request refused by a content or safety policy. Azure OpenAI reports `content_filter`
 * with `innererror.code` ResponsibleAIPolicyViolation; OpenRouter tags failures with `error_type`.
 */
const contentPolicyCodes = new Set([
  "content_filter",
  "responsibleaipolicyviolation",
  "content_policy_violation",
  "image_content_policy_violation",
  "refusal",
])

// OpenCode Zen replaces upstream codes outside its allow-list but keeps the original as a `[code]`
// label at the start of the rewritten message.
const gatewayCodeLabel = /^[^:\n]+: \[([A-Za-z0-9_.-]+)\]/

export type ProviderFailureInput = {
  readonly status?: number
  /** The response or stream error body, as text or already decoded. */
  readonly body?: unknown
  readonly message?: string
}

/**
 * Whether a provider failure is an exhausted account (quota, credits, billing, a free-tier cap)
 * rather than a throttle: HTTP 402, a quota code anywhere a provider or router puts one, or quota
 * wording on a 429.
 */
export const isQuotaFailure = (input: ProviderFailureInput) =>
  input.status === 402 ||
  failureCodes(input).some((code) => quotaCodes.has(code)) ||
  (input.status === 429 && [input.message, bodyText(input.body)].some((text) => !!text && quotaText.test(text)))

/** Whether a provider failure carries a content or safety policy code; the same request is refused again. */
export const isContentPolicyFailure = (input: ProviderFailureInput) =>
  failureCodes(input).some((code) => contentPolicyCodes.has(code))

const failureCodes = (input: ProviderFailureInput) =>
  [
    ...providerCodes(input.body),
    ...providerCodes(input.message),
    ...(gatewayCodeLabel.exec(input.message ?? "")?.slice(1) ?? []),
  ].map((code) => code.trim().toLowerCase())

const bodyText = (body: unknown) =>
  typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body)

/**
 * The codes a provider or router sets on an error body, including the upstream error a router
 * forwards in `error.metadata.raw`.
 */
const providerCodes = (value: unknown): string[] => {
  const decoded = record(typeof value === "string" ? Option.getOrUndefined(decodeJson(value)) : value)
  if (!decoded) return []
  const error = record(decoded.error)
  const metadata = record(error?.metadata)
  const raw = metadata?.raw
  return [
    decoded.code,
    decoded.error_type,
    error?.code,
    error?.type,
    error?.error_type,
    record(error?.innererror)?.code,
    metadata?.error_type,
  ]
    .filter((code): code is string => typeof code === "string")
    .concat(typeof raw === "string" ? providerCodes(raw) : [])
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"

/**
 * The numbers a context-overflow message carries, when it carries any.
 *
 * `limit` is what the provider enforces and `counted` what it counted for the refused request.
 * When the provider counts the requested output together with the input (`includesOutput`), both
 * numbers cover input plus `output` tokens of completion, so the input the provider accepts is
 * `limit - output`.
 */
export type ContextOverflowNumbers = {
  readonly limit?: number
  readonly counted?: number
  readonly output?: number
  readonly includesOutput?: boolean
}

/**
 * A token count: plain digits, or digits in groups of three behind a thousands separator, which
 * some gateways localise (`131,072`, `131.072`, `131 072`). `131.07` is not a count.
 */
const N = String.raw`(\d{1,3}(?:[.,_ ]\d{3})+|\d+)`
const number = (raw: string | undefined) => {
  if (raw === undefined) return undefined
  const value = Number(raw.replace(/[.,_ ]/g, ""))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

type Shape = {
  readonly pattern: RegExp
  readonly read: (match: RegExpMatchArray) => ContextOverflowNumbers
}

const shapes: readonly Shape[] = [
  // Together, Fireworks, Novita and the routers in front of them.
  {
    pattern: new RegExp(String.raw`input length ${N} exceeds the maximum allowed input length of ${N} tokens?`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Anthropic.
  {
    pattern: new RegExp(String.raw`prompt is too long:?\s*${N} tokens? > ${N} maximum`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // OpenAI and compatible servers, with the breakdown between messages and completion.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?(?:requested|resulted in) ${N} tokens\b.*?\(${N} (?:in|from) (?:the |your )?(?:input )?messages,? (?:and )?${N} (?:in|for) the completion\)`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[3]), output: number(m[4]), includesOutput: true }),
  },
  // The same without the breakdown: the count covers the completion the request asked for.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?(?:requested|resulted in)(?: a total of)? ${N} tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]), includesOutput: true }),
  },
  // OpenRouter and OpenAI-compatible gateways that report the resolved input alone, with the
  // image expansion the provider counted in. The limit is the whole window; the count is input.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?resolved to ${N} input tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]) }),
  },
  // Azure OpenAI and vLLM variants.
  {
    pattern: new RegExp(
      String.raw`maximum context length of ${N} tokens\b.*?requested a total of ${N} tokens:? ${N} tokens? (?:from|in) the input messages and ${N} tokens? for the completion`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[3]), output: number(m[4]), includesOutput: true }),
  },
  {
    pattern: new RegExp(
      String.raw`maximum context length of ${N} tokens\b.*?requested(?: a total of)? ${N} tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]), includesOutput: true }),
  },
  // "120000 + max_tokens 8192 > 128000"; other arithmetic says nothing about a limit.
  {
    pattern: new RegExp(String.raw`${N}\s*\+\s*max_tokens\s*${N}\s*>\s*${N}`, "i"),
    read: (m) => ({ counted: number(m[1]), output: number(m[2]), limit: number(m[3]), includesOutput: true }),
  },
  // llama.cpp, LM Studio and friends.
  {
    pattern: new RegExp(
      String.raw`input \(${N} tokens?\) is longer than the model'?s context length \(${N} tokens?\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  {
    pattern: new RegExp(
      String.raw`input length \(${N}\) exceeds (?:the )?model'?s maximum context length \(${N}\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  {
    pattern: new RegExp(String.raw`prompt has ${N} tokens?, but the configured context size is ${N} tokens?`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Gemini.
  {
    pattern: new RegExp(
      String.raw`input token count \(${N}\) exceeds the maximum number of tokens allowed \(${N}\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Messages that only say what the limit is.
  {
    pattern: new RegExp(String.raw`maximum context length of ${N} tokens?`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`maximum context length\s*\(${N}\)`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`too large for model with ${N} maximum context length`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`context length is only ${N} tokens?`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  // "maximum prompt length is N" and "exceeds the limit of N" classify a refusal but teach
  // nothing: the same words announce a limit on images, tools or uploads.
]

/**
 * Reads the limit and count out of a context-overflow message or response body. Routers wrap the
 * upstream message in their own envelope, so the whole text is searched, JSON escapes included.
 */
export const contextOverflowNumbers = (text: string): ContextOverflowNumbers | undefined => {
  for (const shape of shapes) {
    const match = shape.pattern.exec(text)
    if (!match) continue
    const numbers = shape.read(match)
    if (numbers.limit === undefined && numbers.counted === undefined) continue
    return numbers
  }
  return undefined
}
