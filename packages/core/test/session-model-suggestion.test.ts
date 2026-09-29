import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionModelSuggestion } from "@opencode/core/session/model-suggestion"
import { Info } from "@opencode/schema/config"

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
