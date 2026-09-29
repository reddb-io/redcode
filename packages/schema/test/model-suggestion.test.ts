import { describe, expect, test } from "bun:test"
import { Model } from "../src/model.js"
import { ModelSuggestion } from "../src/model-suggestion.js"

const suggestion = (trigger: ModelSuggestion.Trigger, modelID = "claude"): ModelSuggestion.Info => ({
  trigger,
  current: Model.Ref.parse("red-router/small"),
  model: Model.Ref.parse(`red-router/${modelID}`),
  name: modelID.toUpperCase(),
  kind: "model",
  why: [{ code: "vision", detail: "supports vision" }],
  whyText: "supports vision",
  delta: { pricePct: -45, context: 72_000, gained: ["vision"], lost: ["pdf"] },
})

describe("ModelSuggestion", () => {
  test("offers a suggestion on the session metadata and keeps the other keys", () => {
    const metadata = ModelSuggestion.offer({ budget: { maxTokens: 10 } }, suggestion("vision"))
    expect(metadata?.budget).toEqual({ maxTokens: 10 })
    expect(ModelSuggestion.read(metadata).pending).toEqual(suggestion("vision"))
  })

  test("does not offer the suggestion already pending again", () => {
    const metadata = ModelSuggestion.offer({}, suggestion("vision"))
    expect(ModelSuggestion.offer(metadata, suggestion("vision"))).toBeUndefined()
    expect(
      ModelSuggestion.read(ModelSuggestion.offer(metadata, suggestion("vision", "gemini"))).pending?.model.id,
    ).toBe(Model.ID.make("gemini"))
  })

  test("switch answers the pending suggestion with the model to select and drops it", () => {
    const answered = ModelSuggestion.answer(ModelSuggestion.offer({ title: "kept" }, suggestion("cheaper")), "switch")
    expect(answered?.suggestion.model).toEqual(Model.Ref.parse("red-router/claude"))
    expect(answered?.metadata.title).toBe("kept")
    expect(ModelSuggestion.read(answered?.metadata)).toEqual({})
    // Switching does not silence the trigger: a later suggestion for it is offered again.
    expect(ModelSuggestion.offer(answered?.metadata, suggestion("cheaper", "gemini"))).toBeDefined()
  })

  test("keep drops the suggestion and never offers its trigger again", () => {
    const answered = ModelSuggestion.answer(ModelSuggestion.offer({}, suggestion("context")), "keep")
    expect(ModelSuggestion.read(answered?.metadata)).toEqual({ kept: ["context"] })
    expect(ModelSuggestion.offer(answered?.metadata, suggestion("context", "gemini"))).toBeUndefined()
    expect(ModelSuggestion.offer(answered?.metadata, suggestion("vision"))).toBeDefined()
  })

  test("nothing to answer without a pending suggestion, and malformed state reads as empty", () => {
    expect(ModelSuggestion.answer({}, "keep")).toBeUndefined()
    expect(ModelSuggestion.read({ [ModelSuggestion.METADATA_KEY]: { pending: { trigger: "nope" } } })).toEqual({})
  })

  test("describes deltas and quota resets in compact words", () => {
    expect(ModelSuggestion.deltaParts(suggestion("vision").delta)).toEqual([
      "price -45%",
      "context +72K",
      "+vision",
      "-pdf",
    ])
    expect(ModelSuggestion.deltaParts({ pricePct: null, context: 0, gained: [], lost: [] })).toEqual([])
    const now = Date.now()
    expect(ModelSuggestion.quotaText({ ...suggestion("vision"), until: now - 1 }, now)).toBeUndefined()
    expect(ModelSuggestion.quotaText({ ...suggestion("vision"), until: now + 60_000 }, now)).toStartWith("quota until ")
  })
})
