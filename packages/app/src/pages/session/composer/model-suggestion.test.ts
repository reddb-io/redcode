import { describe, expect, test } from "bun:test"
import type { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { answerSuggestion, suggestionCard } from "./model-suggestion"

const router = { id: "red-router", name: "RedRouter", router: { kind: "red-router" as const } }

const suggestion: ModelSuggestion.Info = {
  trigger: "context",
  current: { providerID: "red-router", modelID: "small" },
  model: { providerID: "red-router", modelID: "pin:claude@bedrock" },
  name: "Claude Sonnet 4.5",
  kind: "flat",
  why: [{ code: "context", detail: "200,000 tokens of context fit 90,000 in use" }],
  whyText: "200,000 tokens of context fit 90,000 in use",
  delta: { pricePct: 20, context: 1_000_000, gained: [], lost: [] },
}

const models = [
  { id: "small", name: "Small", provider: router },
  {
    id: "pin:claude@bedrock",
    name: "Claude Sonnet 4.5",
    provider: router,
    upstream: { id: "bedrock", name: "Bedrock" },
  },
]

describe("model suggestion card", () => {
  test("names the suggested model by its route and shows the reason and deltas", () => {
    expect(suggestionCard({ suggestion, selected: models[0], models })).toEqual({
      label: "RedRouter » Bedrock · Claude Sonnet 4.5",
      why: "200,000 tokens of context fit 90,000 in use",
      deltas: "price +20% · context +1M",
    })
  })

  test("hides once another model is selected or when the suggested one is not listed", () => {
    expect(suggestionCard({ suggestion, selected: models[1], models })).toBeUndefined()
    expect(suggestionCard({ suggestion, selected: models[0], models: [models[0]!] })).toBeUndefined()
  })
})

describe("answering a model suggestion", () => {
  test("switch selects the suggested model (a pinned offer by its pin id); keep selects nothing", async () => {
    const selected: unknown[] = []
    const resolved: unknown[] = []
    const answer = (choice: ModelSuggestion.Choice) =>
      answerSuggestion({
        suggestion,
        choice,
        select: (model) => selected.push(model),
        resolve: async (value) => resolved.push(value),
      })
    await answer("keep")
    expect(selected).toEqual([])
    await answer("switch")
    expect(selected).toEqual([{ providerID: "red-router", modelID: "pin:claude@bedrock" }])
    expect(resolved).toEqual([
      { trigger: "context", choice: "keep" },
      { trigger: "context", choice: "switch" },
    ])
  })
})
