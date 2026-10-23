import { Schema } from "effect"
import { Money } from "@opencode/schema/money"
import type { AnyRoute } from "@opencode/ai/route"
import { expect, test } from "bun:test"
import { LLM, Usage, LLMRequest, Message, Media } from "@opencode/ai"
import { AI } from "@opencode/ai/promise"
import { AnthropicMessages, Gemini, OpenAIChat } from "@opencode/ai/protocols"
import { SessionUsage } from "@opencode/core/session/usage"
import { ModelPricing } from "@opencode/core/model-pricing"
import type { Model } from "@opencode/schema/model"

const catalog = (pricing: Model.Catalog["pricing"]): Model.Catalog => ({
  format: 2,
  digest: "fixture-prices",
  apis: {},
  rates: [],
  pricing,
})

async function observed(route: AnyRoute, events: unknown[]) {
  const calls: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls.push(new URL(request.url).pathname)
      const body = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optional(Schema.String) }))(
        await request.json(),
      )
      expect(body.model === "metered-fixture" || new URL(request.url).pathname.includes("metered-fixture")).toBe(true)
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const ai = AI.make()
  try {
    const model = route.with({ endpoint: { baseURL: server.url.toString() } }).model({ id: "metered-fixture" })
    const request = LLM.request({ model, prompt: "fixture" })
    const response = await ai.llm.generate(request)
    expect(calls).toHaveLength(1)
    expect(response.usage).toBeDefined()
    return { usage: response.usage!, request, model }
  } finally {
    server.stop(true)
    await ai.dispose()
  }
}

const anthropic = (usage: object) => [
  { type: "message_start", message: { usage } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
]

test("meters Anthropic cache TTLs through HTTP, including partial streaming usage", async () => {
  const result = await observed(
    AnthropicMessages.route,
    anthropic({
      input_tokens: 100,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 10 },
    }),
  )
  const recorded = SessionUsage.record(
    result.usage,
    {
      cost: [],
      model: result.model,
      catalog: catalog({
        text: { input: { price: 2, cache: { read: 0.2, write: { "5m": 2.5, "1h": 4 } } }, output: { price: 8 } },
      }),
    },
    result.request,
  )
  expect(recorded.cost).toBeCloseTo(0.000506, 12)
  expect(recorded.costAssessment).toEqual({ status: "estimated", catalogDigest: "fixture-prices" })
  expect(recorded.tokens).toEqual({ input: 100, output: 20, reasoning: 0, cache: { read: 30, write: 50 } })
})

test.each([
  { cache_creation_input_tokens: 50 },
  { cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 40 } },
])("does not infer absent TTL quantities or discard unassigned cache writes", async (writes) => {
  const result = await observed(AnthropicMessages.route, anthropic({ input_tokens: 100, ...writes }))
  expect(
    SessionUsage.record(result.usage, {
      cost: [],
      catalog: catalog({
        text: { input: { price: 2, cache: { write: { "5m": 2.5, "1h": 4 } } }, output: { price: 8 } },
      }),
    }).costAssessment?.status,
  ).toBe("unknown")
})

test("meters OpenAI audio separately from text through HTTP", async () => {
  const result = await observed(OpenAIChat.route, [
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        prompt_tokens_details: { audio_tokens: 40 },
        completion_tokens_details: { audio_tokens: 10, reasoning_tokens: 5 },
      },
    },
  ])
  const recorded = SessionUsage.record(result.usage, {
    cost: [],
    catalog: catalog({
      text: { input: { price: 2 }, output: { price: 8 } },
      audio: { input: { price: 10 }, output: { price: 20 } },
    }),
  })
  expect(recorded.cost).toBeCloseTo(0.00088, 12)
  expect(recorded.costAssessment?.status).toBe("estimated")
  expect(recorded.tokens).toEqual({ input: 100, output: 25, reasoning: 5, cache: { read: 0, write: 0 } })
})

test("keeps cached audio unknown when its cache modality is not reported", async () => {
  const result = await observed(OpenAIChat.route, [
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        prompt_tokens_details: { audio_tokens: 40, cached_tokens: 20 },
      },
    },
  ])
  expect(
    SessionUsage.record(result.usage, {
      cost: [],
      catalog: catalog({
        text: { input: { price: 2, cache: { read: 0.2 } }, output: { price: 8 } },
        audio: { input: { price: 10, cache: { read: 1 } } },
      }),
    }).costAssessment?.status,
  ).toBe("unknown")
})

test("meters Gemini modality and cache detail arrays without overlapping totals", async () => {
  const result = await observed(Gemini.route, [
    {
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 20,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 5,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 60 },
          { modality: "AUDIO", tokenCount: 40 },
        ],
        cacheTokensDetails: [
          { modality: "TEXT", tokenCount: 10 },
          { modality: "AUDIO", tokenCount: 10 },
        ],
        candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 10 }],
      },
    },
  ])
  const recorded = SessionUsage.record(result.usage, {
    cost: [],
    catalog: catalog({
      text: { input: { price: 2, cache: { read: 0.2 } }, output: { price: 8 } },
      audio: { input: { price: 10, cache: { read: 1 } } },
    }),
  })
  expect(recorded.cost).toBeCloseTo(0.000532, 12)
  expect(recorded.costAssessment?.status).toBe("estimated")
  expect(result.usage.providerMetadata?.google).toMatchObject({
    promptTokensDetails: [
      { modality: "TEXT", tokenCount: 60 },
      { modality: "AUDIO", tokenCount: 40 },
    ],
  })
})

test("requires token meters to reconcile and preserves authoritative reported zero", () => {
  const source = catalog({ text: { input: { price: 2 }, output: { price: 8 } } })
  const incomplete = new Usage({
    nonCachedInputTokens: 100,
    outputTokens: 10,
    meters: [{ modality: "text", direction: "input", unit: "token", quantity: 90 }],
  })
  expect(ModelPricing.usage(source, incomplete)).toEqual({ reason: "incomplete-token-meters" })
  expect(SessionUsage.record(new Usage({ ...incomplete, cost: 0 }), { cost: [], catalog: source })).toMatchObject({
    cost: 0,
    costAssessment: { status: "reported" },
  })
})

test("selects explicit versus implicit cache rates only with observed mode", () => {
  const pricing = { text: { input: { price: 2, cache: { read: 0.2, explicit: { read: 0.1 } } } } }
  const meter: ModelPricing.Meter = {
    modality: "text",
    direction: "input",
    unit: "token",
    component: "cache.read",
    quantity: 1_000_000,
  }
  expect(ModelPricing.quote(pricing, [{ ...meter, cacheMode: "explicit" }])).toEqual({ amount: Money.USD.make(0.1) })
  expect(ModelPricing.quote(pricing, [{ ...meter, cacheMode: "implicit" }])).toEqual({ amount: Money.USD.make(0.2) })
  expect(ModelPricing.quote(pricing, [meter])).toEqual({ reason: "cache-mode-not-reported" })
})

test("media requests need observed complete meters, and local token prices cannot silently price audio", () => {
  const model = OpenAIChat.route.model({ id: "fixture-model" })
  const request = LLMRequest.update(LLM.request({ model, prompt: "fixture" }), {
    messages: [Message.user({ type: "media", media: Media.base64("AAEC", "audio/mpeg") })],
  })
  const source = catalog({ text: { input: { price: 2 }, output: { price: 8 } }, audio: { input: { price: 10 } } })
  const usage = new Usage({
    nonCachedInputTokens: 100,
    outputTokens: 0,
    meters: [
      { modality: "text", direction: "input", unit: "token", quantity: 60 },
      { modality: "audio", direction: "input", unit: "token", quantity: 40 },
    ],
  })
  const recorded = SessionUsage.record(usage, { cost: [], catalog: source, model }, request)
  expect(recorded.cost).toBeCloseTo(0.00052, 12)
  expect(recorded.costAssessment?.status).toBe("estimated")
  expect(
    SessionUsage.record(
      new Usage({ nonCachedInputTokens: 100, outputTokens: 0 }),
      { cost: [], catalog: source, model },
      request,
    ).costAssessment?.status,
  ).toBe("unknown")
  expect(
    SessionUsage.record(
      usage,
      {
        cost: [
          {
            input: Money.USDPerMillionTokens.make(2),
            output: Money.USDPerMillionTokens.make(8),
            cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
          },
        ],
        catalog: source,
        model,
      },
      request,
    ).costAssessment,
  ).toEqual({ status: "unknown", reason: "token-prices-do-not-cover-meters" })
})
