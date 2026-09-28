export * as SessionBudget from "./session-budget.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "./schema.js"

const Positive = Schema.Finite.check(Schema.isGreaterThan(0))

export const Limits = Schema.Struct({
  maxCostUsd: Positive.pipe(optional),
  maxTokens: PositiveInt.pipe(optional),
}).annotate({ identifier: "SessionBudget.Limits" })
export type Limits = typeof Limits.Type

export const Totals = Schema.Struct({
  cost: Schema.Finite,
  tokens: NonNegativeInt,
  unpriced: NonNegativeInt,
}).annotate({ identifier: "SessionBudget.Totals" })
export type Totals = typeof Totals.Type

export const View = Schema.Struct({
  limits: Limits,
  override: Limits,
  spent: Totals,
  exceeded: Schema.Boolean,
  unknown: Schema.Boolean,
  reason: Schema.String,
}).annotate({ identifier: "SessionBudget.View" })
export type View = typeof View.Type

export const Update = Schema.Struct({
  maxCostUsd: Schema.NullOr(Positive).pipe(optional),
  maxTokens: Schema.NullOr(PositiveInt).pipe(optional),
}).annotate({ identifier: "SessionBudget.Update" })
export type Update = typeof Update.Type

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

export const SEPARATORS =
  "use a dot for decimals (2.50), or a comma with one or two digits (2,50); commas between thousands take three digits (1,000)"

export function parseNumber(raw: string): Parsed<number> {
  const text = raw.trim()
  const normalized = /^\d+(\.\d+)?$/.test(text)
    ? text
    : /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)
      ? text.replace(/,/g, "")
      : /^\d+,\d{1,2}$/.test(text)
        ? text.replace(",", ".")
        : undefined
  if (normalized === undefined) return fail(`"${text}" is not a number: ${SEPARATORS}`)
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return fail(`"${text}" must be more than zero`)
  return ok(value)
}

export function parseCost(raw: string): Parsed<number> {
  const text = raw
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/\s*usd$/i, "")
  if (!text) return fail("a cost needs an amount, such as $2.50")
  return parseNumber(text)
}

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

export function parseTurns(raw: string): Parsed<number> {
  const text = raw.trim()
  const value = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1)
    return fail(`"${text}" is not a number of steps: use a whole number from 1`)
  return ok(value)
}

export type Change = Update & { readonly maxTurns?: number }

export function parse(raw: string): Parsed<Change> {
  const input = raw.trim().toLowerCase()
  if (!input) return fail("enter an amount such as $5, 200k tokens, or off")
  if (input === "off" || input === "none") return ok({ maxCostUsd: null, maxTokens: null })
  const words = input.split(/\s+/)
  const result: { maxCostUsd?: number; maxTokens?: number; maxTurns?: number } = {}
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    const next = words[index + 1]
    if (word.startsWith("$") || word.endsWith("usd")) {
      const cost = parseCost(word)
      if (!cost.ok) return cost
      result.maxCostUsd = cost.value
      continue
    }
    if (next?.startsWith("step") || next?.startsWith("turn")) {
      const turns = parseTurns(word)
      if (!turns.ok) return turns
      result.maxTurns = turns.value
      index++
      continue
    }
    if (/[km]$/.test(word) || next?.startsWith("token")) {
      const tokens = parseTokens(word)
      if (!tokens.ok) return tokens
      result.maxTokens = tokens.value
      if (next?.startsWith("token")) index++
      continue
    }
    if (/^\d+$/.test(word) && words.length === 1) {
      const turns = parseTurns(word)
      if (!turns.ok) return turns
      result.maxTurns = turns.value
      continue
    }
    return fail(`"${word}" is not understood: write $5 for dollars, 200k tokens for tokens, or 30 steps`)
  }
  return ok(result)
}
