import { describe, expect, test } from "bun:test"
import { LanguageModel, LLMRequest, ToolDefinition, ToolNamespace, Usage } from "@opencode/ai"
import { OpenAIResponses } from "@opencode/ai/protocols"
import type { Model } from "@opencode/schema/model"
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
      costAssessment: { status: "reported" },
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

test("marks absent prices as unknown and preserves reported zero", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 100 }), [])).toMatchObject({
    cost: 0,
    costAssessment: { status: "unknown", reason: "missing-pricing" },
  })
  expect(SessionUsage.record(new Usage({ cost: 0 }), [])).toMatchObject({
    cost: 0,
    costAssessment: { status: "reported" },
  })
  expect(SessionUsage.record(undefined, costs).costAssessment?.status).toBe("unknown")
  expect(SessionUsage.record(new Usage({}), costs).costAssessment?.status).toBe("unknown")
})

test("aggregates a known subtotal while retaining incomplete cost coverage", () => {
  const reported = SessionUsage.record(new Usage({ cost: 0.5 }), costs)
  const unknown = SessionUsage.record(new Usage({ nonCachedInputTokens: 100 }), [])
  expect(SessionUsage.add(reported, unknown)).toMatchObject({ cost: 0.5, costAssessment: { status: "unknown" } })
  expect(SessionUsage.add(reported, reported)).toMatchObject({ cost: 1, costAssessment: { status: "reported" } })
})

test("uses conditional catalog prices and preserves explicit local token-price overrides", () => {
  const catalog: Model.Catalog = {
    format: 2,
    digest: "quote-source",
    apis: {},
    rates: [],
    pricing: {
      text: { input: { price: 2, overrides: [{ when: { context: { gt: 100 } }, price: 4 }] }, output: { price: 8 } },
      multipliers: [{ when: { service_tier: { equals: "priority" } }, factor: 2 }],
    },
  }
  const model = LanguageModel.make({ id: "priced", provider: "test", route: OpenAIResponses.route })
  const request = new LLMRequest({
    model,
    system: [],
    messages: [],
    tools: [],
    providerOptions: { serviceTier: "priority" },
  })
  const usage = new Usage({ nonCachedInputTokens: 1000, outputTokens: 100 })
  const conditional = SessionUsage.record(usage, { cost: [], catalog, model }, request)
  expect(conditional.cost).toBeCloseTo(0.0096)
  expect(conditional.costAssessment).toEqual({ status: "estimated", catalogDigest: "quote-source" })
  expect(SessionUsage.record(usage, { cost: [], catalog, model }).costAssessment?.status).toBe("unknown")
  expect(SessionUsage.record(usage, { cost: costs, catalog, model }, request)).toMatchObject({
    cost: 0.0028,
    costAssessment: { status: "estimated" },
  })
  expect(
    SessionUsage.record(usage, { cost: costs, catalog, model }, request).costAssessment?.catalogDigest,
  ).toBeUndefined()
  const other = LanguageModel.make({ id: "other", provider: "test", route: OpenAIResponses.route })
  expect(
    SessionUsage.record(usage, { cost: costs, catalog, model }, LLMRequest.update(request, { model: other })),
  ).toMatchObject({ cost: 0, costAssessment: { status: "unknown", reason: "replaced-request-model" } })
})

test("native tool declarations remain unpriced without observed meters, while reported amounts win", () => {
  const catalog: Model.Catalog = {
    format: 2,
    digest: "quote-source",
    apis: {},
    rates: [],
    pricing: { text: { input: { price: 2 }, output: { price: 8 } } },
  }
  const model = LanguageModel.make({ id: "priced", provider: "test", route: OpenAIResponses.route })
  const request = new LLMRequest({
    model,
    system: [],
    messages: [],
    tools: [
      ToolNamespace.make({
        name: "native",
        tools: [
          ToolDefinition.make({
            name: "search",
            description: "Search",
            inputSchema: {},
            native: { openai: { type: "web_search" } },
          }),
        ],
      }),
    ],
  })
  expect(
    SessionUsage.record(new Usage({ nonCachedInputTokens: 100 }), { cost: costs, catalog, model }, request)
      .costAssessment?.status,
  ).toBe("unknown")
  expect(SessionUsage.record(new Usage({ cost: 0.25 }), { cost: costs, catalog, model }, request)).toMatchObject({
    cost: 0.25,
    costAssessment: { status: "reported" },
  })
})
