import { describe, expect, test } from "bun:test"
import { SessionBudget } from "@/session/budget"

const spent = (cost: number, tokens: number, unpriced = 0) => ({ cost, tokens, unpriced })

describe("a spend limit, checked", () => {
  test("no limits: never exceeded, never a warning", () => {
    const status = SessionBudget.check({}, spent(1_000, 10_000_000))
    expect(status).toMatchObject({ exceeded: false, warn: false, unknown: false })
    expect(SessionBudget.hasLimits({})).toBe(false)
  })

  test("the cost limit is reached at its value and says so in dollars", () => {
    const status = SessionBudget.check({ max_cost_usd: 2 }, spent(2, 10))
    expect(status.exceeded).toBe(true)
    expect(status.reason).toBe("$2.00 of $2.00 spent")
    expect(SessionBudget.pauseReason(status)).toBe("budget: $2.00 of $2.00 spent")
  })

  test("80% of the tighter limit warns", () => {
    expect(SessionBudget.check({ max_cost_usd: 10, max_tokens: 1000 }, spent(1, 800)).warn).toBe(true)
    expect(SessionBudget.check({ max_cost_usd: 10, max_tokens: 1000 }, spent(1, 700)).warn).toBe(false)
  })

  test("unpriced spend makes a cost limit unknown; the token limit still holds", () => {
    const status = SessionBudget.check({ max_cost_usd: 1, max_tokens: 1500 }, spent(0, 2000, 2000))
    expect(status.unknown).toBe(true)
    expect(status.exceeded).toBe(true)
    expect(status.reason).toBe("2,000 of 1,500 tokens spent")
  })

  test("spend counts from a start, and never goes negative", () => {
    expect(SessionBudget.since(spent(3, 30), spent(1, 10))).toEqual(spent(2, 20))
    expect(SessionBudget.since(spent(1, 10), spent(3, 30))).toEqual(spent(0, 0))
  })

  test("raising a limit changes its warning key, so the warning can fire again", () => {
    expect(SessionBudget.warningKey("session:warn", { max_cost_usd: 2 })).not.toBe(
      SessionBudget.warningKey("session:warn", { max_cost_usd: 4 }),
    )
  })
})

describe("limits, read and changed", () => {
  test("lenient reading drops anything that is not a positive number", () => {
    expect(SessionBudget.limitsOf({ max_cost_usd: -1, max_tokens: "lots" })).toEqual({})
    expect(SessionBudget.limitsOf(undefined)).toEqual({})
  })

  test("an update sets, removes with null, and keeps what it does not name", () => {
    expect(SessionBudget.update({ max_cost_usd: 2, max_tokens: 100 }, { max_cost_usd: 5 })).toEqual({
      max_cost_usd: 5,
      max_tokens: 100,
    })
    expect(SessionBudget.update({ max_cost_usd: 2, max_tokens: 100 }, { max_tokens: null })).toEqual({ max_cost_usd: 2 })
  })

  test("costs and token counts parse from what a person types", () => {
    expect(SessionBudget.parseCost("$2.50")).toEqual({ ok: true, value: 2.5 })
    expect(SessionBudget.parseCost("3 usd")).toEqual({ ok: true, value: 3 })
    expect(SessionBudget.parseCost("free").ok).toBe(false)
    expect(SessionBudget.parseTokens("500k")).toEqual({ ok: true, value: 500_000 })
    expect(SessionBudget.parseTokens("1.5m tokens")).toEqual({ ok: true, value: 1_500_000 })
    expect(SessionBudget.parseTokens("0").ok).toBe(false)
  })

  test("a decimal comma is a decimal, three digits after a comma are thousands, and mixed separators are refused", () => {
    expect(SessionBudget.parseCost("2,50")).toEqual({ ok: true, value: 2.5 })
    expect(SessionBudget.parseCost("$2,5")).toEqual({ ok: true, value: 2.5 })
    expect(SessionBudget.parseCost("1,000")).toEqual({ ok: true, value: 1000 })
    expect(SessionBudget.parseCost("12,345.50")).toEqual({ ok: true, value: 12345.5 })
    expect(SessionBudget.parseTokens("1,5m")).toEqual({ ok: true, value: 1_500_000 })
    expect(SessionBudget.parseTokens("20,000 tokens")).toEqual({ ok: true, value: 20_000 })
    const mixed = SessionBudget.parseCost("1.000,50")
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) expect(mixed.error).toContain("use a dot for decimals")
    expect(SessionBudget.parseCost("2,5,0").ok).toBe(false)
    expect(SessionBudget.parseTokens("12,5000").ok).toBe(false)
  })

  test("fork metadata drops spend and the goal's start, and keeps every limit", () => {
    expect(
      SessionBudget.forkMetadata({
        spend: { cost: 3, tokens: 30, unpriced: 0 },
        budget: { max_cost_usd: 5 },
        goal: { objective: "x", budget: { max_tokens: 10 }, spendStart: { cost: 1, tokens: 1, unpriced: 0 } },
      }),
    ).toEqual({ budget: { max_cost_usd: 5 }, goal: { objective: "x", budget: { max_tokens: 10 } } })
  })

  test("an override keeps reset_on_message alongside the limits and removes it with null", () => {
    const set = SessionBudget.updateOverride({ max_cost_usd: 2 }, { reset_on_message: true })
    expect(set).toEqual({ max_cost_usd: 2, reset_on_message: true })
    expect(SessionBudget.overrideOf(set)).toEqual({ limits: { max_cost_usd: 2 }, reset_on_message: true })
    expect(SessionBudget.updateOverride(set, { reset_on_message: null, max_cost_usd: null })).toBeUndefined()
  })

  test("a message is a person's when it has non-synthetic text", () => {
    const messages = [
      { info: { id: "a" }, parts: [{ type: "text", text: "hi" }] },
      { info: { id: "b" }, parts: [{ type: "text", text: "[Continuing]", synthetic: true }] },
    ]
    expect(SessionBudget.human(messages, "a")).toBe(true)
    expect(SessionBudget.human(messages, "b")).toBe(false)
  })
})
