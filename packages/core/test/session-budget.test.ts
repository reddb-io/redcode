import { describe, expect, test } from "bun:test"
import { SessionBudget } from "@opencode/core/session/budget"

describe("SessionBudget", () => {
  test("reads configured limits and ignores an absent or empty budget", () => {
    expect(SessionBudget.configured({ max_cost_usd: 2.5, max_tokens: 500_000 })).toEqual({
      maxCostUsd: 2.5,
      maxTokens: 500_000,
    })
    expect(SessionBudget.configured({ max_tokens: 1_000 })).toEqual({ maxTokens: 1_000 })
    expect(SessionBudget.configured(undefined)).toEqual({})
    expect(SessionBudget.hasLimits(SessionBudget.configured({}))).toBe(false)
  })

  test("a configured limit stops once spend reaches it", () => {
    const limits = SessionBudget.configured({ max_cost_usd: 1 })
    expect(SessionBudget.check(limits, { cost: 0.5, tokens: 10, unpriced: 0 }).exceeded).toBe(false)
    expect(SessionBudget.check(limits, { cost: 1, tokens: 10, unpriced: 0 })).toMatchObject({
      exceeded: true,
      reason: "$1.00 of $1.00 spent",
    })
  })
})
