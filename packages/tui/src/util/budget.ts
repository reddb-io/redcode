/**
 * Spend limits as the TUI shows and edits them. Budgets are opt-in: every line here renders only
 * when the person set a limit, and nothing is suggested when none is.
 */

export interface Limits {
  readonly max_cost_usd?: number
  readonly max_tokens?: number
}

export interface Totals {
  readonly cost: number
  readonly tokens: number
  readonly unpriced: number
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined)
const amount = (value: unknown) => positive(value) ?? 0

export function limitsOf(raw: unknown): Limits {
  const value = record(raw)
  const cost = positive(value.max_cost_usd)
  const tokens = positive(value.max_tokens)
  return { ...(cost !== undefined ? { max_cost_usd: cost } : {}), ...(tokens !== undefined ? { max_tokens: tokens } : {}) }
}

export const hasLimits = (limits: Limits) => limits.max_cost_usd !== undefined || limits.max_tokens !== undefined

export function totalsOf(raw: unknown): Totals {
  const value = record(raw)
  return { cost: amount(value.cost), tokens: amount(value.tokens), unpriced: amount(value.unpriced) }
}

const since = (total: Totals, start: Totals | undefined): Totals =>
  start
    ? {
        cost: Math.max(0, total.cost - start.cost),
        tokens: Math.max(0, total.tokens - start.tokens),
        unpriced: Math.max(0, total.unpriced - start.unpriced),
      }
    : total

export const money = (value: number) => `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
const count = (value: number) => Math.round(value).toLocaleString("en-US")

/** "$1.20 of $5.00" and "12,000 of 500,000 tokens", for the limits that exist. */
export function lines(limits: Limits, spent: Totals): string[] {
  const reached =
    (limits.max_cost_usd !== undefined && spent.cost >= limits.max_cost_usd) ||
    (limits.max_tokens !== undefined && spent.tokens >= limits.max_tokens)
  const out = [
    ...(limits.max_cost_usd !== undefined
      ? [`${money(spent.cost)} of ${money(limits.max_cost_usd)}${spent.unpriced > 0 ? " (cost partly unknown)" : ""}`]
      : []),
    ...(limits.max_tokens !== undefined ? [`${count(spent.tokens)} of ${count(limits.max_tokens)} tokens`] : []),
  ]
  if (reached && out.length) out[out.length - 1] += " · reached"
  return out
}

export interface SidebarBudget {
  readonly session: string[]
  readonly goal: string[]
}

/**
 * What the sidebar shows under "$ spent": the session budget (configuration merged with the
 * session's own override) and the goal budget, each only when a limit exists.
 */
export function sidebar(input: { metadata: unknown; configured: unknown; child: boolean }): SidebarBudget {
  const metadata = record(input.metadata)
  const spend = record(metadata.spend)
  const total = totalsOf(spend)
  const override = limitsOf(metadata.budget)
  const limits = input.child ? override : { ...limitsOf(input.configured), ...override }
  const goal = record(metadata.goal)
  const goalLimits = limitsOf(goal.budget)
  const goalActive = goal.status === "active" || goal.status === "paused"
  return {
    session: hasLimits(limits) ? lines(limits, since(total, spend.baseline ? totalsOf(spend.baseline) : undefined)) : [],
    goal:
      goalActive && hasLimits(goalLimits)
        ? lines(goalLimits, since(total, goal.spendStart ? totalsOf(goal.spendStart) : undefined))
        : [],
  }
}

/** "$5", "5.50", "200k tokens", "$5 200k", "off" — what `/budget` and `/goal-budget` accept. */
export function parse(text: string): { max_cost_usd?: number | null; max_tokens?: number | null; max_turns?: number } | undefined {
  const input = text.trim().toLowerCase()
  if (!input) return undefined
  if (input === "off" || input === "none") return { max_cost_usd: null, max_tokens: null }
  const out: { max_cost_usd?: number | null; max_tokens?: number | null; max_turns?: number } = {}
  const words = input.replace(/,/g, "").split(/\s+/)
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    const next = words[index + 1]
    const tokens = /^(\d+(?:\.\d+)?)([km])?$/.exec(word)
    if (word.startsWith("$") || word.endsWith("usd")) {
      const value = positive(Number(word.replace(/^\$/, "").replace(/usd$/, "")))
      if (value === undefined) return undefined
      out.max_cost_usd = value
    } else if (tokens && (tokens[2] || next?.startsWith("token"))) {
      const scale = tokens[2] === "m" ? 1_000_000 : tokens[2] === "k" ? 1_000 : 1
      const value = positive(Math.floor(Number(tokens[1]) * scale))
      if (value === undefined) return undefined
      out.max_tokens = value
      if (next?.startsWith("token")) index++
    } else if (tokens && next?.startsWith("turn")) {
      const value = Number(tokens[1])
      if (!Number.isSafeInteger(value) || value < 1) return undefined
      out.max_turns = value
      index++
    } else if (/^\d+$/.test(word) && words.length === 1) {
      // A bare whole number keeps meaning turns in /goal-budget; callers without turns reject it.
      out.max_turns = Number(word)
    } else return undefined
  }
  return Object.keys(out).length ? out : undefined
}

export * as Budget from "./budget"
