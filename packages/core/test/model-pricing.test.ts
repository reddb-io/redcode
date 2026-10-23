import { Money } from "@opencode/schema/money"
import { expect, test } from "bun:test"
import { ModelPricing } from "@opencode/core/model-pricing"
import { LanguageModel, LLMRequest } from "@opencode/ai"
import { OpenAIResponses } from "@opencode/ai/protocols"

const input: ModelPricing.Meter = { modality: "text", direction: "input", unit: "token", quantity: 1_000_000 }
const output: ModelPricing.Meter = { modality: "text", direction: "output", unit: "token", quantity: 1_000_000 }

test("applies ordered context overrides and preserves cache fields", () => {
  const pricing = {
    text: {
      input: {
        price: 2,
        cache: { read: 0.2, write: 3 },
        overrides: [
          { when: { context: { gt: 200000 } }, price: 4, cache: { read: 0.4 } },
          { when: { context: { gt: 500000 } }, price: 6 },
        ],
      },
    },
  }
  expect(ModelPricing.quote(pricing, [input], { context: 200000 })).toEqual({ amount: Money.USD.make(2) })
  expect(ModelPricing.quote(pricing, [input], { context: 200001 })).toEqual({ amount: Money.USD.make(4) })
  expect(
    ModelPricing.quote(
      pricing,
      [input, { ...input, component: "cache.read" }, { ...input, component: "cache.write" }],
      { context: 600000 },
    ),
  ).toEqual({ amount: Money.USD.make(9.4) })
  expect(ModelPricing.quote(pricing, [input])).toEqual({ reason: "missing-condition-facts" })
})

test("applies nested price factors after overrides and every matching multiplier", () => {
  const pricing = {
    text: { input: { price: 2, overrides: [{ when: { context: { gt: 100 } }, price: 4 }] }, output: { price: 3 } },
    multipliers: [
      { when: { service_tier: { equals: "priority" } }, factor: { text: { input: 2 } } },
      { when: { region: { in: ["us", "eu"] } }, factor: 0.5 },
    ],
  }
  expect(
    ModelPricing.quote(pricing, [input, output], { context: 200, service_tier: "priority", region: "eu" }),
  ).toEqual({ amount: Money.USD.make(5.5) })
  expect(ModelPricing.quote(pricing, [input], { context: 200 })).toEqual({ reason: "unresolved-multiplier" })
})

test("supports nested conditions, lexical dates and skips unknown condition keys", () => {
  const pricing = {
    text: {
      input: {
        price: 2,
        overrides: [
          {
            when: {
              all: [
                { date: { gte: "2026-01-01" } },
                { any: [{ region: { equals: "eu" } }, { not: { thinking: { equals: true } } }] },
              ],
            },
            price: 4,
          },
          { when: { unknown_future_key: { equals: true } }, price: 999 },
        ],
      },
    },
  }
  expect(ModelPricing.quote(pricing, [input], { date: "2026-10-23", region: "eu" })).toEqual({
    amount: Money.USD.make(4),
  })
  expect(ModelPricing.quote(pricing, [input], { date: "2025-10-23" })).toEqual({ amount: Money.USD.make(2) })
})

test("preserves units for characters, images, minutes and searches", () => {
  expect(
    ModelPricing.quote(
      {
        text: { input: { price: 2, unit: "character" } },
        image: { output: { price: 0.04, unit: "image" } },
        audio: { input: { price: 0.006, unit: "minute" } },
        web_search: { price: 10 },
      },
      [
        { ...input, unit: "character" },
        { modality: "image", direction: "output", unit: "image", quantity: 2 },
        { modality: "audio", direction: "input", unit: "minute", quantity: 10 },
        { modality: "web_search", direction: "search", unit: "search", quantity: 100 },
      ],
    ),
  ).toEqual({ amount: Money.USD.make(3.14) })
  expect(ModelPricing.quote({ text: { input: { price: 2, unit: "character" } } }, [input])).toEqual({
    reason: "unit-mismatch:character:token",
  })
})

test("selects an explicit cache write TTL and refuses to invent one", () => {
  const pricing = { text: { input: { price: 2, cache: { write: { "5m": 2.5, "1h": 4 } } } } }
  expect(ModelPricing.quote(pricing, [{ ...input, component: "cache.write", cacheTTL: "5m" }])).toEqual({
    amount: Money.USD.make(2.5),
  })
  expect(ModelPricing.quote(pricing, [{ ...input, component: "cache.write", cacheTTL: "1h" }])).toEqual({
    amount: Money.USD.make(4),
  })
  expect(ModelPricing.quote(pricing, [{ ...input, component: "cache.write" }])).toEqual({
    reason: "missing-price:cache.write",
  })
})

test("reasoning uses its own rate or the multiplied output rate", () => {
  const multipliers = [{ when: {}, factor: { text: { output: { price: 2, reasoning: 3 } } } }]
  expect(
    ModelPricing.quote({ text: { output: { price: 2, reasoning: 3 } }, multipliers }, [
      output,
      { ...output, component: "reasoning" },
    ]),
  ).toEqual({ amount: Money.USD.make(13) })
  expect(
    ModelPricing.quote({ text: { output: { price: 2 } }, multipliers }, [
      output,
      { ...output, component: "reasoning" },
    ]),
  ).toEqual({ amount: Money.USD.make(8) })
})

test("rejects unknown units, invalid prices and quantities, and preserves true zero", () => {
  expect(ModelPricing.quote({ text: { input: { price: 0 } } }, [input])).toEqual({ amount: Money.USD.make(0) })
  expect(ModelPricing.quote(undefined, [input])).toEqual({ reason: "missing-or-invalid-pricing" })
  expect(ModelPricing.quote({ text: { input: { price: -1 } } }, [input])).toEqual({
    reason: "missing-or-invalid-pricing",
  })
  expect(ModelPricing.quote({ text: { input: { price: 2, unit: "future" } } }, [{ ...input, unit: "future" }])).toEqual(
    { reason: "unsupported-unit:future" },
  )
  expect(ModelPricing.quote({ text: { input: { price: 2 } } }, [{ ...input, quantity: NaN }])).toEqual({
    reason: "invalid-meter-quantity",
  })
})

test("unknown storage and explicit cache mode do not become token-only estimates", () => {
  expect(ModelPricing.quote({ text: { input: { price: 2, cache: { storage: 0.25 } } } }, [input])).toEqual({
    reason: "unmetered-cache-storage",
  })
  expect(
    ModelPricing.quote({ text: { input: { price: 2, cache: { read: 0.2, explicit: { read: 0.1 } } } } }, [
      { ...input, component: "cache.read" },
    ]),
  ).toEqual({ reason: "cache-mode-not-reported" })
})

test("reads effective request options with HTTP body precedence and keeps missing facts unknown", () => {
  const model = LanguageModel.make({
    id: "test",
    provider: "test",
    route: OpenAIResponses.route,
    defaults: { providerOptions: { serviceTier: "priority", region: "us" } },
  })
  const request = new LLMRequest({
    model,
    system: [],
    messages: [],
    tools: [],
    providerOptions: { serviceTier: "flex" },
    http: { body: { service_tier: "default" } },
  })
  expect(ModelPricing.request(request)).toEqual({ service_tier: "default", region: "us" })
  expect(
    ModelPricing.request(
      new LLMRequest({
        model: LanguageModel.make({ id: "test", provider: "test", route: OpenAIResponses.route }),
        system: [],
        messages: [],
        tools: [],
      }),
    ),
  ).toEqual({})
})

test("merges TTL maps field by field across matching overrides", () => {
  const pricing = {
    text: {
      input: {
        price: 2,
        cache: { write: { "5m": 2.5, "1h": 4 } },
        overrides: [{ when: { region: { equals: "eu" } }, cache: { write: { "1h": 5 } } }],
      },
    },
  }
  expect(
    ModelPricing.quote(pricing, [{ ...input, component: "cache.write", cacheTTL: "5m" }], { region: "eu" }),
  ).toEqual({ amount: Money.USD.make(2.5) })
  expect(
    ModelPricing.quote(pricing, [{ ...input, component: "cache.write", cacheTTL: "1h" }], { region: "eu" }),
  ).toEqual({ amount: Money.USD.make(5) })
})

test("does not silently discard unsupported price fields or reinterpret declared search units", () => {
  expect(ModelPricing.quote({ currency: "EUR", text: { input: { price: 2 } } }, [input])).toEqual({
    reason: "missing-or-invalid-pricing",
  })
  expect(
    ModelPricing.quote({ web_search: { price: 10, unit: "image" } }, [
      { modality: "web_search", direction: "search", unit: "search", quantity: 1000 },
    ]),
  ).toEqual({ reason: "unit-mismatch:image:search" })
})
