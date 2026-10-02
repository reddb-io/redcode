import { describe, expect, test } from "bun:test"
import { Usage } from "@opencode/ai"
import { Money } from "@opencode/schema/money"
import { SessionUsage } from "@opencode/core/session/usage"

const costs = [
  {
    input: Money.USDPerMillionTokens.make(2),
    output: Money.USDPerMillionTokens.make(8),
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  },
]

describe("provider-reported request cost", () => {
  test.each([0, 0.125])("prefers reported USD %s while preserving token accounting", (cost) => {
    const usage = new Usage({ nonCachedInputTokens: 1_000, outputTokens: 100, reasoningTokens: 40, cost })
    expect(SessionUsage.record(usage, costs)).toEqual({
      cost: Money.USD.make(cost),
      tokens: { input: 1_000, output: 60, reasoning: 40, cache: { read: 0, write: 0 } },
    })
  })

  test.each([undefined, -1, NaN, Infinity, -Infinity])(
    "estimates from catalog for invalid or absent cost %s",
    (cost) => {
      expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000, outputTokens: 100, cost }), costs).cost).toBe(
        Money.USD.make(0.0028),
      )
    },
  )
})
