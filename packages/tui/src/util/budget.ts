export * as Budget from "./budget"

import { SessionBudget } from "@opencode/schema/session-budget"

export const parse = SessionBudget.parse

export const hasLimits = (limits: SessionBudget.Limits | undefined) =>
  limits !== undefined && (limits.maxCostUsd !== undefined || limits.maxTokens !== undefined)

export const money = (value: number) => `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
const count = (value: number) => Math.round(value).toLocaleString("en-US")

export const since = (total: SessionBudget.Totals, start: SessionBudget.Totals | undefined) =>
  start
    ? {
        cost: Math.max(0, total.cost - start.cost),
        tokens: Math.max(0, total.tokens - start.tokens),
        unpriced: Math.max(0, total.unpriced - start.unpriced),
      }
    : total

export function lines(limits: SessionBudget.Limits, spent: SessionBudget.Totals) {
  const reached =
    (limits.maxCostUsd !== undefined && spent.cost >= limits.maxCostUsd) ||
    (limits.maxTokens !== undefined && spent.tokens >= limits.maxTokens)
  const output = [
    ...(limits.maxCostUsd === undefined
      ? []
      : [`${money(spent.cost)} of ${money(limits.maxCostUsd)}${spent.unpriced > 0 ? " (cost partly unknown)" : ""}`]),
    ...(limits.maxTokens === undefined ? [] : [`${count(spent.tokens)} of ${count(limits.maxTokens)} tokens`]),
  ]
  if (reached && output.length) output[output.length - 1] += " · reached"
  return output
}

export const describe = (limits: SessionBudget.Limits) =>
  [
    ...(limits.maxCostUsd === undefined ? [] : [money(limits.maxCostUsd)]),
    ...(limits.maxTokens === undefined ? [] : [`${count(limits.maxTokens)} tokens`]),
  ].join(", ")
