import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"

const decode = Schema.decodeUnknownSync(Model.Ref)

describe("Model.parse", () => {
  test.each([
    ["vendor/model", "vendor", "model"],
    ["vendor/team/model", "vendor", "team/model"],
    ["vendor", "vendor", ""],
    ["", "", ""],
    ["/model", "", "model"],
    ["vendor/", "vendor", ""],
    ["vendor//model/", "vendor", "/model/"],
  ])("parses %j at the first slash", (input, providerID, modelID) => {
    expect(Model.parse(input)).toEqual({
      providerID: Provider.ID.make(providerID),
      modelID: Model.ID.make(modelID),
    })
  })
})

describe("Model.Ref", () => {
  test("accepts a model selection without a variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic" })).toEqual({
      id: Model.ID.make("claude-sonnet"),
      providerID: Provider.ID.make("anthropic"),
    })
  })

  test("preserves an explicit model variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic", variant: "high" })).toEqual({
      id: Model.ID.make("claude-sonnet"),
      providerID: Provider.ID.make("anthropic"),
      variant: Model.VariantID.make("high"),
    })
  })
})

describe("Model.preference", () => {
  const model = (providerID: string, id: string, released: number, apiKey?: string) => ({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
    time: { released },
    ...(apiKey === undefined ? {} : { settings: { apiKey } }),
  })

  test("orders the newest release first", () => {
    expect([model("a", "old", 1000), model("a", "new", 2000)].sort(Model.preference).map((item) => item.id)).toEqual([
      Model.ID.make("new"),
      Model.ID.make("old"),
    ])
  })

  test("puts anonymous free-tier models after every connected model, so they are never the implicit default", () => {
    const ordered = [
      model("opencode", "free-preview", 3000, "public"),
      model("anthropic", "older", 1000, "secret"),
      model("openai", "newer", 2000),
    ].sort(Model.preference)
    expect(ordered.map((item) => item.id)).toEqual([
      Model.ID.make("newer"),
      Model.ID.make("older"),
      Model.ID.make("free-preview"),
    ])
  })

  test("keeps release order among anonymous free-tier models", () => {
    expect(
      [model("opencode", "old", 1000, "public"), model("opencode", "new", 2000, "public")]
        .sort(Model.preference)
        .map((item) => item.id),
    ).toEqual([Model.ID.make("new"), Model.ID.make("old")])
  })
})
