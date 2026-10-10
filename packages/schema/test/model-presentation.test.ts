import { describe, expect, test } from "bun:test"
import { ModelPresentation } from "../src/model-presentation.js"

describe("catalogUpdateMessage", () => {
  test("counts the models a router catalog refresh added, removed and renamed", () => {
    expect(ModelPresentation.catalogUpdateMessage({ name: "RedRouter", added: 2, removed: 1, renamed: 0 })).toBe(
      "RedRouter catalog updated: +2/−1 models",
    )
    expect(ModelPresentation.catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 3 })).toBe(
      "RedRouter catalog updated: +0/−0 models, 3 renamed",
    )
  })

  test("stays quiet when only limits or modes changed", () => {
    expect(
      ModelPresentation.catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 0 }),
    ).toBeUndefined()
  })
})

describe("offerDetails", () => {
  const offer = {
    id: "zen/jev-1.13",
    provider: { id: "zen", name: "OpenCode Zen" },
    via: [],
    available: true,
    price: { input: 0.3, output: 1.25 },
    free: false,
  }

  test("reads price, availability and whether the offer serves now", () => {
    expect(ModelPresentation.offerDetails({ offer, lead: true, model: {} })).toBe(
      "$0.3/$1.25 per 1M · available · serving now",
    )
  })

  test("names an unavailable offer that cannot be pinned", () => {
    expect(
      ModelPresentation.offerDetails({ offer: { ...offer, available: false, price: undefined }, lead: false }),
    ).toBe("unavailable · cannot be pinned")
  })

  test("prices free offers as free and unknown halves as unknown", () => {
    expect(ModelPresentation.offerPrice({ ...offer, free: true })).toBe("free")
    expect(ModelPresentation.offerPrice({ free: false, price: { output: 15 } })).toBe("?/$15 per 1M")
  })

  test("uses the words a client passes", () => {
    const words = {
      ...ModelPresentation.text,
      available: "disponível",
      price: (price: { input?: number; output?: number }) => `${price.input}|${price.output}`,
    }
    expect(ModelPresentation.offerDetails({ offer, lead: false, model: {} }, words)).toBe("0.3|1.25 · disponível")
  })
})

describe("modelDescription", () => {
  const model = { id: "anthropic/claude", providerID: "red-router", name: "Claude" }

  test("reads a direct model as its connection and id", () => {
    expect(
      ModelPresentation.modelDescription(
        { ...model, providerID: "anthropic", id: "claude" },
        { id: "anthropic", name: "Anthropic" },
      ),
    ).toBe("Anthropic · claude")
  })

  test("names router hops, aliases, an automatic route and a subscription", () => {
    expect(
      ModelPresentation.modelDescription(
        { ...model, flat: true, aliases: ["sonnet"], upstream: { name: "Antigravity", subscription: true } },
        { id: "red-router", name: "RedRouter" },
      ),
    ).toBe("RedRouter » Antigravity · anthropic/claude · aliases: sonnet · automatic route · subscription")
  })
})

describe("prioritizeFavorites", () => {
  test("uses the favorite order captured when the dialog opened", () => {
    const prioritized = ModelPresentation.prioritizeFavorites(
      [
        { title: "Best match", value: { providerID: "test", modelID: "best" } },
        { title: "Favorite match", value: { providerID: "test", modelID: "favorite" } },
        { title: "Second best match", value: { providerID: "test", modelID: "second-best" } },
        { title: "Second favorite match", value: { providerID: "test", modelID: "second-favorite" } },
      ],
      new Set(["test/favorite", "test/second-favorite"]),
    )

    expect(prioritized.map((model) => model.title)).toEqual([
      "Favorite match",
      "Second favorite match",
      "Best match",
      "Second best match",
    ])
  })
})

describe("sortModelOptions", () => {
  test.each(["browse", "search", "provider"])("orders %s results free-first, then newest-first", (mode) => {
    const options = [
      { providerID: "opencode", title: "Claude Haiku 3", releaseDate: 1 },
      { providerID: "anthropic", title: "Claude Haiku 4.5", releaseDate: 2 },
      { providerID: "anthropic", title: "Claude Haiku Free", releaseDate: 0, footer: "Free" },
    ].map((item) => ({ ...item, providerID: mode === "provider" ? "anthropic" : item.providerID }))
    expect(ModelPresentation.sortModelOptions(options, mode === "provider").map((item) => item.title)).toEqual([
      "Claude Haiku Free",
      "Claude Haiku 4.5",
      "Claude Haiku 3",
    ])
  })

  test("orders OpenCode Go before Zen and other providers", () => {
    const sorted = ModelPresentation.sortModelOptions([
      { providerID: "openai", providerName: "OpenAI", releaseDate: 3, title: "GPT 5" },
      { providerID: "opencode", providerName: "OpenCode Zen", releaseDate: 1, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 2, title: "Claude Opus 4" },
      { providerID: "opencode-go", providerName: "OpenCode Go", releaseDate: 0, title: "Kimi K3" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Kimi K3", "Claude Sonnet 4", "Claude Opus 4", "GPT 5"])
  })

  test("keeps ungrouped results free-first regardless of OpenCode provider", () => {
    const sorted = ModelPresentation.sortModelOptions(
      [
        { providerID: "opencode-go", releaseDate: 3, title: "Go model" },
        { providerID: "opencode", releaseDate: 1, title: "Free Zen model", footer: "Free" },
        { providerID: "anthropic", releaseDate: 4, title: "Anthropic model" },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Free Zen model", "Anthropic model", "Go model"])
  })

  test("orders provider groups by provider name and models by newest release", () => {
    const sorted = ModelPresentation.sortModelOptions([
      { providerID: "google", providerName: "Google", releaseDate: 5, title: "Gemini 2.5 Pro" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 4, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 6, title: "Claude Opus 4" },
      { providerID: "openai", providerName: "OpenAI", releaseDate: 7, title: "GPT 5" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Opus 4", "Claude Sonnet 4", "Gemini 2.5 Pro", "GPT 5"])
  })

  test("falls back to title when release dates match within a provider", () => {
    const sorted = ModelPresentation.sortModelOptions([
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 5, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 5, title: "Claude Opus 4" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Opus 4", "Claude Sonnet 4"])
  })
})

describe("preferences", () => {
  test("moves a model to the front, deduplicates, and limits recents", () => {
    const recent = Array.from({ length: 12 }, (_, index) => ({
      providerID: "provider",
      modelID: `model-${index}`,
    }))

    expect(ModelPresentation.recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
      { providerID: "provider", modelID: "model-5" },
      ...recent.slice(0, 5),
      ...recent.slice(6, 10),
    ])
  })

  test("puts a new favorite first and removes an unmarked one", () => {
    const favorites = [
      { providerID: "a", modelID: "one" },
      { providerID: "a", modelID: "two" },
    ]
    expect(ModelPresentation.favoriteModels({ providerID: "a", modelID: "two" }, favorites, true)).toEqual([
      { providerID: "a", modelID: "two" },
      { providerID: "a", modelID: "one" },
    ])
    expect(ModelPresentation.favoriteModels({ providerID: "a", modelID: "one" }, favorites, false)).toEqual([
      { providerID: "a", modelID: "two" },
    ])
  })

  test("cycles a list in both directions and wraps around", () => {
    const list = ["one", "two", "three"].map((modelID) => ({ providerID: "a", modelID }))
    expect(ModelPresentation.cycleModel(list, list[2], 1)).toBe(list[0])
    expect(ModelPresentation.cycleModel(list, list[0], -1)).toBe(list[2])
    expect(ModelPresentation.cycleModel(list, { providerID: "b", modelID: "x" }, 1)).toBe(list[0])
    expect(ModelPresentation.cycleModel(list, undefined, -1)).toBe(list[2])
    expect(ModelPresentation.cycleModel([], list[0], 1)).toBeUndefined()
  })
})
