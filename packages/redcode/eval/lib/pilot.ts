/**
 * Cost estimates before any money is spent.
 *
 * A pilot replays the eval's cassette against the scripted provider, which costs nothing, and
 * measures what a real model would be sent: the byte size of every request the harness built
 * (system prompt, tool schemas, history) and the size of every scripted answer. Priced with the
 * target model's catalog rates, that is the estimate. It undercounts a model that wanders, so the
 * runner compares it with the hard budget rather than trusting it as a cap.
 */

/** USD per million tokens, as the models catalog lists them. */
export interface Pricing {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
}

export interface Exchange {
  readonly requestBytes: number
  readonly responseBytes: number
}

export interface Estimate {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly usd: number
}

/** Four bytes a token: close enough for English prose, code and JSON schemas to budget with. */
export const BYTES_PER_TOKEN = 4

export function tokens(bytes: number) {
  return Math.ceil(Math.max(0, bytes) / BYTES_PER_TOKEN)
}

export function estimate(exchanges: readonly Exchange[], pricing: Pricing): Estimate {
  const inputTokens = exchanges.reduce((sum, item) => sum + tokens(item.requestBytes), 0)
  const outputTokens = exchanges.reduce((sum, item) => sum + tokens(item.responseBytes), 0)
  const usd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  return { requests: exchanges.length, inputTokens, outputTokens, usd: round(usd) }
}

/** Parses the catalog's model entry (`cost.input`, `cost.output`, `cost.cache_read`). */
export function pricingFrom(entry: unknown): Pricing | undefined {
  if (!entry || typeof entry !== "object") return undefined
  const cost = (entry as { cost?: Record<string, unknown> }).cost
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") return undefined
  return {
    input: cost.input,
    output: cost.output,
    ...(typeof cost.cache_read === "number" ? { cacheRead: cost.cache_read } : {}),
  }
}

/** Finds `provider/model` in a models.dev-shaped catalog. */
export function lookup(catalog: unknown, model: string) {
  if (!catalog || typeof catalog !== "object") return undefined
  const slash = model.indexOf("/")
  if (slash <= 0) return undefined
  const provider = (catalog as Record<string, any>)[model.slice(0, slash)]
  const entry = provider?.models?.[model.slice(slash + 1)]
  if (!entry) return undefined
  return { pricing: pricingFrom(entry), family: typeof entry.family === "string" ? entry.family : undefined }
}

/** Models of one provider that can call tools, cheapest first, for `--catalog <provider>`. */
export function catalogModels(catalog: unknown, provider: string, limit = 5) {
  const models = (catalog as Record<string, any> | undefined)?.[provider]?.models
  if (!models || typeof models !== "object") return []
  return Object.entries(models as Record<string, any>)
    .filter(([, entry]) => entry?.tool_call === true && pricingFrom(entry))
    .sort(([, a], [, b]) => pricingFrom(a)!.input + pricingFrom(a)!.output - (pricingFrom(b)!.input + pricingFrom(b)!.output))
    .slice(0, limit)
    .map(([id]) => `${provider}/${id}`)
}

function round(usd: number) {
  return Math.round(usd * 1_000_000) / 1_000_000
}

export * as EvalPilot from "./pilot"
