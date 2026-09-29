import { describe, expect, test } from "bun:test"
import { Media, Message } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Mcp } from "@opencode/core/mcp/index"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ProviderRouter } from "@opencode/core/provider-router"
import { SessionModelSuggestion } from "@opencode/core/session/model-suggestion"
import { Info } from "@opencode/schema/config"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { Money } from "@opencode/schema/money"
import { emptyMcp } from "./fixture/mcp"

const providerID = Provider.ID.make("red-router")
const current = Model.Ref.parse("red-router/text-only")

const model = (id: string, input: { image?: boolean } = {}) => ({
  ...Model.Info.default(providerID, Model.ID.make(id)),
  capabilities: { tools: true, input: input.image ? ["text", "image"] : ["text"], output: ["text"] },
})

const models = [model("text-only"), model("claude", { image: true }), model("cheap"), model("pinned@zen")]

function recommendation(
  id: string,
  input: {
    capabilities?: string[]
    usable?: boolean
    state?: string
    lost?: string[]
    pct?: number | null
    provider?: string
    offers?: { id: string; pin_id?: string; available: boolean }[]
  } = {},
) {
  return {
    id,
    name: id.toUpperCase(),
    kind: "model",
    context_length: 200_000,
    capabilities: input.capabilities ?? ["vision", "tools"],
    status: { state: input.state ?? "ok" },
    usable: input.usable ?? true,
    ...(input.provider ? { provider: { id: input.provider } } : {}),
    why: [{ code: "vision", detail: "supports vision" }],
    why_text: "supports vision",
    delta: {
      price_delta_pct: input.pct === undefined ? 10 : input.pct,
      context_delta: 72_000,
      gained_capabilities: ["vision"],
      lost_capabilities: input.lost ?? [],
    },
    ...(input.offers ? { offers: input.offers } : {}),
  }
}

const suggest = (args: unknown, recommendations: unknown[], extra: Record<string, unknown> = {}) =>
  SessionModelSuggestion.suggest({ args, output: { recommendations, ...extra }, current, models })

describe("SessionModelSuggestion", () => {
  test("reads the router's structured output or its JSON text, dropping malformed recommendations alone", () => {
    const output = { current: recommendation("text-only"), recommendations: [recommendation("claude"), { id: 42 }] }
    expect(SessionModelSuggestion.parse(output)?.recommendations.map((item) => item.id)).toEqual(["claude"])
    expect(SessionModelSuggestion.parse(output)?.current?.id).toBe("text-only")
    expect(SessionModelSuggestion.parse(JSON.stringify(output))?.recommendations).toHaveLength(1)
    expect(SessionModelSuggestion.parse("not json")).toBeUndefined()
    expect(SessionModelSuggestion.parse({ models: [] })).toBeUndefined()
  })

  test("names the trigger from the arguments the agent sent", () => {
    const textOnly = model("text-only")
    expect(SessionModelSuggestion.triggerOf({ needs: ["vision", "tools"] }, textOnly)).toBe("vision")
    expect(SessionModelSuggestion.triggerOf({ needs: ["vision"] }, model("claude", { image: true }))).toBe("requested")
    expect(SessionModelSuggestion.triggerOf({ needs: ["tools"] }, textOnly)).toBe("requested")
    expect(SessionModelSuggestion.triggerOf({ min_context: 300_000 }, textOnly)).toBe("context")
    expect(SessionModelSuggestion.triggerOf({ equivalent_to: "text-only", prefer: "cheapest" }, textOnly)).toBe(
      "cheaper",
    )
  })

  test("suggests the first usable model of the connection, with the router's reasons and deltas", () => {
    const suggestion = suggest({ needs: ["vision"] }, [
      recommendation("claude", { usable: false }),
      recommendation("claude", { state: "rate_limited" }),
      recommendation("text-only"),
      recommendation("unlisted"),
      recommendation("claude"),
    ])
    expect(suggestion).toEqual({
      trigger: "vision",
      current: { providerID, id: Model.ID.make("text-only") },
      model: { providerID, id: Model.ID.make("claude") },
      name: "CLAUDE",
      kind: "model",
      why: [{ code: "vision", detail: "supports vision" }],
      whyText: "supports vision",
      delta: { pricePct: 10, context: 72_000, gained: ["vision"], lost: [] },
    })
  })

  test("never suggests a model that loses or lacks a needed capability", () => {
    expect(
      suggest({ needs: ["vision", "pdf"] }, [
        recommendation("claude", { lost: ["pdf"], capabilities: ["vision", "pdf"] }),
        recommendation("claude", { capabilities: ["vision"] }),
      ]),
    ).toBeUndefined()
  })

  test("a cheaper equivalent loses nothing and costs at least 40% less", () => {
    const args = { equivalent_to: "text-only", prefer: "cheapest" }
    expect(suggest(args, [recommendation("cheap", { pct: -20 })])).toBeUndefined()
    expect(suggest(args, [recommendation("cheap", { pct: null })])).toBeUndefined()
    expect(suggest(args, [recommendation("cheap", { pct: -60, lost: ["vision"] })])).toBeUndefined()
    expect(suggest(args, [recommendation("cheap", { pct: -60 })])?.model.id).toBe(Model.ID.make("cheap"))
  })

  test("an unlisted flat model is selected through its first available pinned offer", () => {
    const offers = [
      { id: "offer-a", pin_id: "missing@zen", available: true },
      { id: "offer-b", pin_id: "pinned@zen", available: false },
      { id: "offer-c", pin_id: "pinned@zen", available: true },
    ]
    expect(suggest({}, [recommendation("flat", { offers })])?.model.id).toBe(Model.ID.make("pinned@zen"))
  })

  test("while the current model is out of quota, its provider is skipped and the reset is kept", () => {
    const until = "2026-09-30T12:00:00.000Z"
    const suggestion = suggest(
      {},
      [recommendation("claude", { provider: "zen" }), recommendation("cheap", { provider: "other" })],
      { current: { ...recommendation("text-only", { provider: "zen" }), status: { state: "quota_exhausted", until } } },
    )
    expect(suggestion?.model.id).toBe(Model.ID.make("cheap"))
    expect(suggestion?.until).toBe(Date.parse(until))
  })

  test("experimental.model_suggestions passes through configuration normalization", () => {
    const result = ConfigNormalize.normalize({ experimental: { model_suggestions: false } })
    if (result.type !== "normalized") throw new Error("expected normalized config")
    expect(result.encoded.experimental).toEqual({ model_suggestions: false })
    expect(Schema.decodeUnknownSync(Info)(result.encoded).experimental?.model_suggestions).toBe(false)
    const invalid = ConfigNormalize.normalize({ experimental: { model_suggestions: "no" } })
    expect(invalid.diagnostics.map((item) => item.path)).toContainEqual(["experimental", "model_suggestions"])
  })
})

const price = (input: number, output: number) => [
  {
    input: Money.USDPerMillionTokens.make(input),
    output: Money.USDPerMillionTokens.make(output),
    cache: { read: Money.USDPerMillionTokens.make(0), write: Money.USDPerMillionTokens.make(0) },
  },
]

const routerMcp = (answer: { isError: boolean; text: string }, calls: unknown[]) =>
  Mcp.Service.of({
    ...emptyMcp,
    servers: () => Effect.succeed([{ name: ProviderRouter.MCP_SERVER, status: { status: "connected" as const } }]),
    callTool: (input) =>
      Effect.sync(() => {
        calls.push(input)
        return {
          isError: answer.isError,
          content: [{ type: "text" as const, text: answer.text }],
          server: Mcp.ServerName.make(ProviderRouter.MCP_SERVER),
          tool: input.name,
        }
      }),
  })

describe("SessionModelSuggestion triggers", () => {
  test("the session needs vision and pdf for attached or returned files, and tools when the step offers any", () => {
    const image = Message.user([Message.media(Media.base64("aGk=", "image/png"))])
    const pdf = Message.tool({
      id: "call-1",
      name: "read",
      result: [{ type: "file", uri: "data:application/pdf;base64,aGk=", mime: "application/pdf" }],
      resultType: "content",
    })
    expect(SessionModelSuggestion.needsOf({ messages: [image, pdf], tools: true })).toEqual(["vision", "pdf", "tools"])
    expect(SessionModelSuggestion.needsOf({ messages: [Message.user("hello")], tools: false })).toEqual([])
  })

  test("fires for images the model cannot see, then tools it cannot call, then a context near its limit", () => {
    const needs = ["vision", "tools"]
    expect(SessionModelSuggestion.detect({ model: model("text-only"), needs })).toEqual({
      trigger: "vision",
      args: { needs, current: "text-only", limit: SessionModelSuggestion.RECOMMENDATIONS },
      needs,
    })
    const toolless = {
      ...model("claude", { image: true }),
      capabilities: { tools: false, input: ["text", "image"], output: ["text"] },
    }
    expect(SessionModelSuggestion.detect({ model: toolless, needs })?.trigger).toBe("tools")
    // 200K context less 32K output leaves 168K usable; 85% of it is 142.8K.
    expect(SessionModelSuggestion.usableContext(model("text-only").limit)).toBe(168_000)
    expect(SessionModelSuggestion.detect({ model: model("text-only"), needs: [], tokens: 150_000 })?.args).toEqual({
      needs: [],
      current: "text-only",
      limit: SessionModelSuggestion.RECOMMENDATIONS,
      needs_input_tokens: 150_000,
      min_context: 200_001,
    })
    expect(SessionModelSuggestion.detect({ model: model("text-only"), needs: [], tokens: 100_000 })).toBeUndefined()
    expect(SessionModelSuggestion.detect({ model: model("text-only"), needs: [] })).toBeUndefined()
  })

  test("measures the context in use from the latest answer's tokens", () => {
    expect(SessionModelSuggestion.contextInUse(undefined)).toBeUndefined()
    expect(
      SessionModelSuggestion.contextInUse({ input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 4 } }),
    ).toBe(154)
  })

  test("asks for a cheaper equivalent only when the catalog lists one 40% cheaper that keeps everything", () => {
    const claude = { ...model("claude", { image: true }), cost: price(3, 15) }
    const cheap = { ...model("cheap", { image: true }), cost: price(1, 5) }
    expect(SessionModelSuggestion.cheaper({ model: claude, models: [claude, cheap], needs: ["tools"] })).toEqual({
      trigger: "cheaper",
      args: {
        needs: ["tools"],
        current: "claude",
        equivalent_to: "claude",
        prefer: "cheapest",
        limit: SessionModelSuggestion.RECOMMENDATIONS,
      },
      needs: ["tools"],
    })
    const blind = { ...model("cheap"), cost: price(1, 5) }
    const pricey = { ...model("cheap", { image: true }), cost: price(10, 5) }
    const disabled = { ...cheap, enabled: false }
    expect(
      SessionModelSuggestion.cheaper({ model: claude, models: [blind, pricey, disabled], needs: [] }),
    ).toBeUndefined()
    expect(SessionModelSuggestion.cheaper({ model: model("claude"), models: [cheap], needs: [] })).toBeUndefined()
  })

  test("classifies provider failures by type and status, never by their text", () => {
    const failure = (type: string, status?: number) => ({ type, message: "whatever the provider said", status })
    expect(SessionModelSuggestion.failureOf(failure("provider.quota"), true)).toBe("quota")
    expect(SessionModelSuggestion.failureOf(failure("provider.error", 402), true)).toBe("quota")
    expect(SessionModelSuggestion.failureOf(failure("provider.rate-limit", 429), false)).toBe("unavailable")
    expect(SessionModelSuggestion.failureOf(failure("provider.rate-limit", 429), true)).toBe("failure")
    expect(SessionModelSuggestion.failureOf(failure("provider.internal", 503), true)).toBe("failure")
    expect(SessionModelSuggestion.failureOf(failure("provider.transport"), true)).toBe("failure")
    expect(SessionModelSuggestion.failureOf(failure("provider.auth", 401), false)).toBeUndefined()
    expect(SessionModelSuggestion.failureOf(failure("provider.invalid-request", 400), false)).toBeUndefined()
  })

  test("asks for an equivalent after repeated failures, and at once when out of quota", () => {
    const textOnly = model("text-only")
    expect(SessionModelSuggestion.afterFailure({ model: textOnly, failure: "failure", failures: 1 })).toBeUndefined()
    expect(SessionModelSuggestion.afterFailure({ model: textOnly, failure: "failure", failures: 2 })).toEqual({
      trigger: "provider_errors",
      args: {
        needs: [],
        current: "text-only",
        equivalent_to: "text-only",
        prefer: "cheapest",
        limit: SessionModelSuggestion.RECOMMENDATIONS,
      },
      needs: [],
    })
    const quota = SessionModelSuggestion.afterFailure({ model: textOnly, failure: "quota", failures: 1 })
    expect(quota?.exhausted).toBe(true)
    expect(quota?.reasons?.map((reason) => reason.code)).toEqual(["quota_exhausted"])
    const unavailable = SessionModelSuggestion.afterFailure({ model: textOnly, failure: "unavailable", failures: 1 })
    expect(unavailable?.exhausted).toBe(true)
  })

  test("an equivalent after failures loses nothing, skips the spent provider and says why first", () => {
    const request = SessionModelSuggestion.afterFailure({ model: model("text-only"), failure: "quota", failures: 1 })
    if (!request) throw new Error("expected a provider_errors request")
    const suggestion = SessionModelSuggestion.recommended({
      request,
      output: {
        recommendations: [
          recommendation("claude", { provider: "zen" }),
          recommendation("cheap", { provider: "other", lost: ["pdf"] }),
          recommendation("cheap", { provider: "other" }),
        ],
        current: recommendation("text-only", { provider: "zen" }),
      },
      current,
      models,
    })
    expect(suggestion?.trigger).toBe("provider_errors")
    expect(suggestion?.model.id).toBe(Model.ID.make("cheap"))
    expect(suggestion?.why.map((reason) => reason.code)).toEqual(["quota_exhausted", "vision"])
    expect(suggestion?.whyText).toBe("the current model is out of quota; supports vision")
  })

  test("remembers per session which trigger was asked for which situation, and failures in a row", () => {
    const tracked = SessionModelSuggestion.tracker(1)
    expect(tracked.claim("ses_a", "vision", "text-only")).toBe(true)
    expect(tracked.claim("ses_a", "vision", "text-only")).toBe(false)
    expect(tracked.claim("ses_a", "vision", "claude")).toBe(true)
    expect(tracked.claim("ses_a", "context", "claude")).toBe(true)
    expect(tracked.fail("ses_a")).toBe(1)
    expect(tracked.fail("ses_a")).toBe(2)
    tracked.recover("ses_a")
    expect(tracked.fail("ses_a")).toBe(1)
    // Past the limit the oldest session is forgotten and may be asked again.
    expect(tracked.claim("ses_b", "vision", "text-only")).toBe(true)
    expect(tracked.claim("ses_a", "context", "claude")).toBe(true)
  })

  test("asks the router's MCP server with the trigger's arguments and records what it suggests", async () => {
    const calls: unknown[] = []
    const request = SessionModelSuggestion.detect({ model: model("text-only"), needs: ["vision"] })
    if (!request) throw new Error("expected a vision trigger")
    const text = JSON.stringify({ recommendations: [recommendation("claude")] })
    const suggestion = await Effect.runPromise(
      SessionModelSuggestion.ask({ request, current, models }).pipe(
        Effect.provideService(Mcp.Service, routerMcp({ isError: false, text }, calls)),
      ),
    )
    expect(calls).toEqual([
      {
        server: "red-router",
        name: "recommend_models",
        args: { needs: ["vision"], current: "text-only", limit: SessionModelSuggestion.RECOMMENDATIONS },
      },
    ])
    expect(suggestion?.trigger).toBe("vision")
    expect(suggestion?.model).toEqual({ providerID, id: Model.ID.make("claude") })
    if (!suggestion) throw new Error("expected a suggestion")
    const metadata = ModelSuggestion.offer({}, suggestion)
    expect(ModelSuggestion.read(metadata).pending?.model.id).toBe(Model.ID.make("claude"))
    // Keeping the model silences the trigger for the session.
    const kept = ModelSuggestion.answer(metadata, "keep")?.metadata
    expect(ModelSuggestion.offer(kept, suggestion)).toBeUndefined()
  })

  test("offers nothing when the router has no MCP server or its call fails", async () => {
    const request = SessionModelSuggestion.detect({ model: model("text-only"), needs: ["vision"] })
    if (!request) throw new Error("expected a vision trigger")
    const text = JSON.stringify({ recommendations: [recommendation("claude")] })
    // emptyMcp lists no server and dies if called.
    expect(
      await Effect.runPromise(
        SessionModelSuggestion.ask({ request, current, models }).pipe(Effect.provideService(Mcp.Service, emptyMcp)),
      ),
    ).toBeUndefined()
    const calls: unknown[] = []
    expect(
      await Effect.runPromise(
        SessionModelSuggestion.ask({ request, current, models }).pipe(
          Effect.provideService(Mcp.Service, routerMcp({ isError: true, text }, calls)),
        ),
      ),
    ).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
