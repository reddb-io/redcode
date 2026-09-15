/**
 * Reading spend limits typed by a person: `$2.50`, `2,50`, `1,000`, `500k tokens`, `1,5m`.
 *
 * One parser for the TUI, the `/goal` text and the server, so an amount means the same thing
 * everywhere. Separators follow one deterministic rule and nothing is guessed:
 *
 * - a dot is a decimal point: `2.50` is 2.5;
 * - a comma followed by exactly three digits, repeated, is a thousands separator: `1,000` is 1000,
 *   `12,345.5` is 12345.5;
 * - a single comma followed by one or two digits at the end is a decimal comma: `2,50` is 2.5,
 *   `1,5m` is 1.5 million;
 * - anything else — a dot and a comma used together the other way (`1.000,50`), a comma followed
 *   by four digits — is refused with a message, never read as some other number.
 */

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

export const SEPARATORS =
  "use a dot for decimals (2.50), or a comma with one or two digits (2,50); commas between thousands take three digits (1,000)"

/** A plain positive number with the separator rules above. */
export function parseNumber(raw: string): Parsed<number> {
  const text = raw.trim()
  let normalized: string | undefined
  if (/^\d+(\.\d+)?$/.test(text)) normalized = text
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) normalized = text.replace(/,/g, "")
  else if (/^\d+,\d{1,2}$/.test(text)) normalized = text.replace(",", ".")
  if (normalized === undefined) return fail(`"${raw.trim()}" is not a number: ${SEPARATORS}`)
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return fail(`"${raw.trim()}" must be more than zero`)
  return ok(value)
}

/** "$5", "5", "2,50 usd" → dollars. */
export function parseCost(raw: string): Parsed<number> {
  const text = raw
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/\s*usd$/i, "")
  if (!text) return fail("a cost needs an amount, such as $2.50")
  return parseNumber(text)
}

/** "500k", "1,5m tokens", "20,000" → whole tokens. */
export function parseTokens(raw: string): Parsed<number> {
  const match = /^(.*?)\s*([km])?\s*(?:tokens?)?$/i.exec(raw.trim())
  const digits = match?.[1] ?? ""
  if (!digits) return fail("a token limit needs an amount, such as 500k")
  const number = parseNumber(digits)
  if (!number.ok) return number
  const scale = match?.[2]?.toLowerCase() === "m" ? 1_000_000 : match?.[2]?.toLowerCase() === "k" ? 1_000 : 1
  const value = Math.floor(number.value * scale)
  if (value < 1) return fail(`"${raw.trim()}" is less than one token`)
  return ok(value)
}

export interface LimitsChange {
  readonly max_cost_usd?: number | null
  readonly max_tokens?: number | null
  readonly max_turns?: number
}

/**
 * What `/budget` and `/goal-budget` accept: `$5`, `200k tokens`, `$2,50 1,5m`, `40 turns $3`, a
 * bare whole number (turns), or `off` to remove both spend limits.
 */
export function parseLimits(raw: string): Parsed<LimitsChange> {
  const input = raw.trim().toLowerCase()
  if (!input) return fail("enter an amount such as $5, 200k tokens, or off")
  if (input === "off" || input === "none") return ok({ max_cost_usd: null, max_tokens: null })
  const words = input.split(/\s+/)
  const out: { max_cost_usd?: number; max_tokens?: number; max_turns?: number } = {}
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    const next = words[index + 1]
    if (word.startsWith("$") || word.endsWith("usd")) {
      const cost = parseCost(word)
      if (!cost.ok) return cost
      out.max_cost_usd = cost.value
      continue
    }
    if (next?.startsWith("turn")) {
      if (!/^\d+$/.test(word) || Number(word) < 1) return fail(`"${word} ${next}" needs a whole number of turns`)
      out.max_turns = Number(word)
      index++
      continue
    }
    if (/[km]$/.test(word) || next?.startsWith("token")) {
      const tokens = parseTokens(word)
      if (!tokens.ok) return tokens
      out.max_tokens = tokens.value
      if (next?.startsWith("token")) index++
      continue
    }
    if (/^\d+$/.test(word) && words.length === 1) {
      out.max_turns = Number(word)
      continue
    }
    return fail(`"${word}" is not understood: write $5 for dollars, 200k tokens for tokens, or 30 turns`)
  }
  return ok(out)
}

export * as BudgetParse from "./budget-parse"
