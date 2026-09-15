import { describe, expect, test } from "bun:test"
import { Budget } from "../../src/util/budget"

describe("sidebar budget lines", () => {
  test("nothing is shown when no budget was set", () => {
    expect(
      Budget.sidebar({ metadata: { spend: { cost: 3, tokens: 9000, unpriced: 0 } }, configured: undefined, child: false }),
    ).toEqual({ session: [], goal: [] })
  })

  test("a session budget shows spend against it, from config merged with the override", () => {
    const view = Budget.sidebar({
      metadata: { spend: { cost: 1.2, tokens: 12_000, unpriced: 0 }, budget: { max_tokens: 500_000 } },
      configured: { max_cost_usd: 5 },
      child: false,
    })
    expect(view.session).toEqual(["$1.20 of $5.00", "12,000 of 500,000 tokens"])
  })

  test("a subagent session ignores the configured budget", () => {
    expect(
      Budget.sidebar({ metadata: { spend: { cost: 1, tokens: 1, unpriced: 0 } }, configured: { max_cost_usd: 5 }, child: true })
        .session,
    ).toEqual([])
  })

  test("a goal budget counts from the goal's start and says when it is reached", () => {
    const view = Budget.sidebar({
      metadata: {
        spend: { cost: 3, tokens: 100, unpriced: 0 },
        goal: { status: "paused", budget: { max_cost_usd: 2 }, spendStart: { cost: 1, tokens: 0, unpriced: 0 } },
      },
      configured: undefined,
      child: false,
    })
    expect(view.goal).toEqual(["$2.00 of $2.00 · reached"])
  })
})

describe("parsing /budget input", () => {
  test("dollars, tokens, both, and off", () => {
    expect(Budget.parse("$5")).toEqual({ max_cost_usd: 5 })
    expect(Budget.parse("200k tokens")).toEqual({ max_tokens: 200_000 })
    expect(Budget.parse("$2.50 1.5m")).toEqual({ max_cost_usd: 2.5, max_tokens: 1_500_000 })
    expect(Budget.parse("off")).toEqual({ max_cost_usd: null, max_tokens: null })
  })

  test("a bare number is turns; garbage is rejected", () => {
    expect(Budget.parse("30")).toEqual({ max_turns: 30 })
    expect(Budget.parse("40 turns $3")).toEqual({ max_turns: 40, max_cost_usd: 3 })
    expect(Budget.parse("lots")).toBeUndefined()
    expect(Budget.parse("$-1")).toBeUndefined()
  })
})
