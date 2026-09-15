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
  const value = (text: string) => {
    const parsed = Budget.parse(text)
    return parsed.ok ? parsed.value : undefined
  }

  test("dollars, tokens, both, and off", () => {
    expect(value("$5")).toEqual({ max_cost_usd: 5 })
    expect(value("200k tokens")).toEqual({ max_tokens: 200_000 })
    expect(value("$2.50 1.5m")).toEqual({ max_cost_usd: 2.5, max_tokens: 1_500_000 })
    expect(value("off")).toEqual({ max_cost_usd: null, max_tokens: null })
  })

  test("the same separator rules as the server: decimal comma, thousands, mixed refused with a reason", () => {
    expect(value("$2,50 1,5m")).toEqual({ max_cost_usd: 2.5, max_tokens: 1_500_000 })
    expect(value("$1,000")).toEqual({ max_cost_usd: 1000 })
    const mixed = Budget.parse("$1.000,50")
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) expect(mixed.error).toContain("use a dot for decimals")
  })

  test("a bare number is turns; garbage is refused with a message", () => {
    expect(value("30")).toEqual({ max_turns: 30 })
    expect(value("40 turns $3")).toEqual({ max_turns: 40, max_cost_usd: 3 })
    const garbage = Budget.parse("lots")
    expect(garbage.ok).toBe(false)
    if (!garbage.ok) expect(garbage.error).toContain("not understood")
    expect(Budget.parse("$-1").ok).toBe(false)
  })
})

test("describeLimits names only the limits", () => {
  expect(Budget.describeLimits({ max_cost_usd: 2, max_tokens: 500_000 })).toBe("$2.00, 500,000 tokens")
})
