import { describe, expect, test } from "bun:test"
import { modelSections, type ModelOptionBase } from "./sections"

const option = (providerID: string, modelID: string, extra: Partial<ModelOptionBase> = {}): ModelOptionBase => ({
  key: `${providerID}:${modelID}`,
  value: { providerID, modelID },
  title: modelID,
  providerID,
  providerName: providerID,
  category: providerID,
  description: `${providerID} · ${modelID}`,
  releaseDate: 0,
  ...extra,
})

const options = [
  option("anthropic", "claude-sonnet", {
    title: "Claude Sonnet",
    providerName: "Anthropic",
    category: "Anthropic",
    releaseDate: 2,
  }),
  option("anthropic", "claude-opus", {
    title: "Claude Opus",
    providerName: "Anthropic",
    category: "Anthropic",
    releaseDate: 3,
  }),
  option("red-router", "anthropic/claude-sonnet", {
    title: "Claude Sonnet",
    providerName: "RedRouter",
    category: "RedRouter » Antigravity",
    releaseDate: 2,
  }),
  option("opencode", "big-pickle", {
    title: "Big Pickle",
    providerName: "OpenCode Zen",
    category: "OpenCode Zen",
    footer: "Free",
  }),
]

const keys = (sections: ReturnType<typeof modelSections<ModelOptionBase>>) =>
  sections.map((section) => [section.key, section.items.map((item) => item.key)])

describe("modelSections", () => {
  test("lists Favorites, then Recent without favorites, then every other model by route", () => {
    expect(
      keys(
        modelSections(options, {
          search: "",
          favorites: [{ providerID: "anthropic", modelID: "claude-opus" }],
          recent: [
            { providerID: "anthropic", modelID: "claude-opus" },
            { providerID: "red-router", modelID: "anthropic/claude-sonnet" },
            { providerID: "gone", modelID: "removed" },
          ],
        }),
      ),
    ).toEqual([
      ["favorites", ["anthropic:claude-opus"]],
      ["recent", ["red-router:anthropic/claude-sonnet"]],
      ["route:OpenCode Zen", ["opencode:big-pickle"]],
      ["route:Anthropic", ["anthropic:claude-sonnet"]],
    ])
  })

  test("skips Favorites and Recent in a picker for one provider", () => {
    expect(
      keys(
        modelSections(
          options.filter((item) => item.providerID === "anthropic"),
          {
            search: "",
            favorites: [{ providerID: "anthropic", modelID: "claude-opus" }],
            recent: [{ providerID: "anthropic", modelID: "claude-sonnet" }],
            provider: "anthropic",
          },
        ),
      ),
    ).toEqual([["route:Anthropic", ["anthropic:claude-opus", "anthropic:claude-sonnet"]]])
  })

  test("puts favorites first among search results", () => {
    expect(
      keys(
        modelSections(options, {
          search: "sonnet",
          favorites: [{ providerID: "red-router", modelID: "anthropic/claude-sonnet" }],
          recent: [],
        }),
      ),
    ).toEqual([["results", ["red-router:anthropic/claude-sonnet", "anthropic:claude-sonnet"]]])
  })

  test("searches routes and ids, and falls back to fuzzy matching", () => {
    expect(keys(modelSections(options, { search: "antigravity", favorites: [], recent: [] }))).toEqual([
      ["results", ["red-router:anthropic/claude-sonnet"]],
    ])
    expect(keys(modelSections(options, { search: "bgpkl", favorites: [], recent: [] }))).toEqual([
      ["results", ["opencode:big-pickle"]],
    ])
    expect(keys(modelSections(options, { search: "no-matching-model", favorites: [], recent: [] }))).toEqual([
      ["results", []],
    ])
  })

  test("a whole query names one model even when its words appear in others", () => {
    const similar = [
      option("opencode", "mobile-a", { title: "Mobile Model A" }),
      option("opencode", "mobile-b", { title: "Mobile Model B" }),
    ]
    expect(keys(modelSections(similar, { search: "Mobile Model B", favorites: [], recent: [] }))).toEqual([
      ["results", ["opencode:mobile-b"]],
    ])
  })
})
