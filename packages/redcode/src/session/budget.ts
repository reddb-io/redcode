/**
 * Spend limits: what a goal or a session may spend on providers, in dollars and in tokens.
 *
 * Everything here is pure. The ledger that feeds it (`spend.ts`) adds each provider step as it
 * finishes; this file only says, from a limit and a total, whether the limit holds, how close it
 * is, and how to say so. A token is a token wherever it went — input, output, reasoning, cache
 * reads and writes — so a token limit bounds work even where no price is known.
 */

import { BUDGET_PAUSE } from "@reddb-io/redcode-core/session/loop-marker"
import { Schema } from "effect"

/** The share of a limit at which the person is warned, once. */
export const WARN_AT = 0.8
/** Session metadata key the ledger writes its running totals to. */
export const SPEND_KEY = "spend"
/** Session metadata key holding a per-session override of the configured limits. */
export const LIMITS_KEY = "budget"

export interface Limits {
  readonly max_cost_usd?: number
  readonly max_tokens?: number
}

export interface Totals {
  readonly cost: number
  readonly tokens: number
  /** Tokens spent on models without pricing: their cost is unknown, not zero. */
  readonly unpriced: number
}

export const ZERO: Totals = { cost: 0, tokens: 0, unpriced: 0 }

const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)
const bound = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined)

export const add = (a: Totals, b: Totals): Totals => ({
  cost: a.cost + b.cost,
  tokens: a.tokens + b.tokens,
  unpriced: a.unpriced + b.unpriced,
})

/** What was spent after `start`; a start from a different history never makes spend negative. */
export const since = (total: Totals, start: Totals | undefined): Totals =>
  start
    ? {
        cost: Math.max(0, total.cost - start.cost),
        tokens: Math.max(0, total.tokens - start.tokens),
        unpriced: Math.max(0, total.unpriced - start.unpriced),
      }
    : total

/** Totals read back from metadata written by any version, or zero. */
export function totalsOf(raw: unknown): Totals {
  if (!raw || typeof raw !== "object") return ZERO
  const value = raw as Record<string, unknown>
  return { cost: amount(value.cost), tokens: amount(value.tokens), unpriced: amount(value.unpriced) }
}

/** Limits read back leniently: anything that is not a positive number is no limit. */
export function limitsOf(raw: unknown): Limits {
  if (!raw || typeof raw !== "object") return {}
  const value = raw as Record<string, unknown>
  const cost = bound(value.max_cost_usd)
  const tokens = bound(value.max_tokens)
  return {
    ...(cost !== undefined ? { max_cost_usd: cost } : {}),
    ...(tokens !== undefined ? { max_tokens: Math.floor(tokens) } : {}),
  }
}

export const hasLimits = (limits: Limits | undefined) =>
  limits !== undefined && (limits.max_cost_usd !== undefined || limits.max_tokens !== undefined)

/** Field by field: an override replaces the configured value it names and leaves the other. */
export const merge = (base: Limits | undefined, override: Limits | undefined): Limits => ({
  ...limitsOf(base),
  ...limitsOf(override),
})

/**
 * An update to limits: a number sets the field, `null` removes it, an absent field is kept.
 * Returns the limits that result.
 */
export function update(current: Limits | undefined, change: { max_cost_usd?: number | null; max_tokens?: number | null }) {
  const next: { max_cost_usd?: number; max_tokens?: number } = { ...limitsOf(current) }
  if (change.max_cost_usd === null) delete next.max_cost_usd
  else if (change.max_cost_usd !== undefined) next.max_cost_usd = change.max_cost_usd
  if (change.max_tokens === null) delete next.max_tokens
  else if (change.max_tokens !== undefined) next.max_tokens = change.max_tokens
  return limitsOf(next)
}

export const money = (value: number) => `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
export const tokens = (value: number) => Math.round(value).toLocaleString("en-US")

/** "$1.20 of $2.00 spent · 12,000 of 500,000 tokens" — only the limits that exist. */
export function describe(limits: Limits, spent: Totals): string {
  return [
    ...(limits.max_cost_usd !== undefined
      ? [`${money(spent.cost)} of ${money(limits.max_cost_usd)} spent${spent.unpriced > 0 ? " (some cost unknown)" : ""}`]
      : []),
    ...(limits.max_tokens !== undefined ? [`${tokens(spent.tokens)} of ${tokens(limits.max_tokens)} tokens`] : []),
  ].join(" · ")
}

export interface Status {
  readonly exceeded: boolean
  /** The largest share of any limit spent: 0.5 is half of the tighter limit. */
  readonly used: number
  readonly warn: boolean
  /**
   * A cost limit is set and some of the spend ran on a model without pricing. The known cost is
   * still enforced — it is a lower bound — and a token limit, if any, bounds the rest.
   */
  readonly unknown: boolean
  /** "$2.00 of $2.00 spent": the limit that was reached, or every limit when none was. */
  readonly reason: string
}

export function check(limits: Limits, spent: Totals): Status {
  const cost = limits.max_cost_usd
  const max = limits.max_tokens
  const costHit = cost !== undefined && spent.cost >= cost
  const tokenHit = max !== undefined && spent.tokens >= max
  const used = Math.max(cost !== undefined ? spent.cost / cost : 0, max !== undefined ? spent.tokens / max : 0)
  return {
    exceeded: costHit || tokenHit,
    used,
    warn: used >= WARN_AT,
    unknown: cost !== undefined && spent.unpriced > 0,
    reason: costHit
      ? `${money(spent.cost)} of ${money(cost)} spent`
      : tokenHit
        ? `${tokens(spent.tokens)} of ${tokens(max)} tokens spent`
        : describe(limits, spent),
  }
}

/** The reason a goal paused at its budget carries. */
export const pauseReason = (status: Status) => `${BUDGET_PAUSE}${status.reason}`

/** A key that changes when the limits do, so raising a limit re-arms its one warning. */
export const warningKey = (scope: string, limits: Limits) =>
  `${scope}:${limits.max_cost_usd ?? "-"}:${limits.max_tokens ?? "-"}`

/** "$5", "5", "5.50 usd" → 5, 5, 5.5. */
export function parseCost(text: string): number | undefined {
  const cleaned = text.trim().replace(/^\$/, "").replace(/\s*usd$/i, "").replace(/,/g, "")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined
  return bound(Number(cleaned))
}

/** "500k", "1.5m tokens", "20,000" → 500000, 1500000, 20000. */
export function parseTokens(text: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?\s*(?:tokens?)?$/i.exec(text.trim().replace(/,/g, ""))
  if (!match) return undefined
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1
  const value = bound(Number(match[1]) * scale)
  return value === undefined ? undefined : Math.floor(value)
}

/**
 * Whether the user message that started this step came from a person: goal continuations and
 * other harness-made turns carry only synthetic text.
 */
export function human(
  messages: ReadonlyArray<{ readonly info: { readonly id: string }; readonly parts: ReadonlyArray<unknown> }>,
  messageID: string,
): boolean {
  const message = messages.findLast((item) => item.info.id === messageID)
  return (message?.parts ?? []).some((part) => {
    const value = part as { type?: string; synthetic?: boolean }
    return (value.type === "text" && !value.synthetic) || value.type === "file"
  })
}

const Positive = Schema.Number.check(Schema.isGreaterThan(0))

export const LimitsInfo = Schema.Struct({
  max_cost_usd: Schema.optional(Positive).annotate({ description: "Dollars that may be spent on providers" }),
  max_tokens: Schema.optional(Positive).annotate({
    description: "Tokens that may be spent on providers: input, output, reasoning and cache, every call counted",
  }),
}).annotate({ identifier: "SpendLimits" })

export const TotalsInfo = Schema.Struct({
  cost: Schema.Number,
  tokens: Schema.Number,
  unpriced: Schema.Number.annotate({ description: "Tokens spent on models without pricing" }),
}).annotate({ identifier: "SpendTotals" })

/** A session's budget as clients see it. */
export const View = Schema.Struct({
  limits: LimitsInfo.annotate({ description: "The limits in force: the configured ones with this session's override" }),
  override: LimitsInfo.annotate({ description: "What this session sets over the configuration" }),
  spent: TotalsInfo.annotate({ description: "What counts against the limits" }),
  exceeded: Schema.Boolean,
  unknown: Schema.Boolean.annotate({ description: "A cost limit is set and some spend has no known price" }),
  reason: Schema.String,
}).annotate({ identifier: "SessionBudget" })

export const UpdatePayload = Schema.Struct({
  max_cost_usd: Schema.optional(Schema.NullOr(Positive)).annotate({
    description: "Dollars this session may spend; null removes the override",
  }),
  max_tokens: Schema.optional(Schema.NullOr(Positive)).annotate({
    description: "Tokens this session may spend; null removes the override",
  }),
})

export * as SessionBudget from "./budget"
