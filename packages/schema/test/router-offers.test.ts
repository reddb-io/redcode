import { describe, expect, test } from "bun:test"
import { Router } from "../src/router.js"

const offer = (id: string, input: Partial<Router.Offer> = {}): Router.Offer => ({
  id,
  provider: { id: id.split("/")[0] ?? id, name: id.split("/")[0] ?? id },
  via: [],
  available: true,
  free: false,
  ...input,
})

describe("offerGroups", () => {
  test("lists pinned models among their flat model's offers instead of as rows of their own", () => {
    const flat = {
      id: "anthropic/claude-sonnet-4-5",
      providerID: "red-router",
      offers: [
        offer("zen/claude-sonnet-4-5", { available: false, pinID: "zen@claude-sonnet-4-5" }),
        offer("bedrock/claude-sonnet-4-5", { pinID: "bedrock@claude-sonnet-4-5" }),
        offer("vertex/claude-sonnet-4-5"),
      ],
    }
    const zen = { id: "zen@claude-sonnet-4-5", providerID: "red-router", pinOf: flat.id }
    const bedrock = { id: "bedrock@claude-sonnet-4-5", providerID: "red-router", pinOf: flat.id }
    const other = { id: "gpt-6", providerID: "openai" }

    const groups = Router.offerGroups([flat, zen, bedrock, other])

    expect(groups.map((group) => group.model.id)).toEqual([flat.id, other.id])
    expect(groups[0]?.offers.map((entry) => [entry.offer.id, entry.model?.id, entry.lead])).toEqual([
      ["zen/claude-sonnet-4-5", zen.id, false],
      ["bedrock/claude-sonnet-4-5", bedrock.id, true],
      ["vertex/claude-sonnet-4-5", undefined, false],
    ])
    expect(groups[1]?.offers).toEqual([])
  })

  test("keeps a pinned model listed when its flat model is not in the list", () => {
    const pinned = { id: "zen@claude-sonnet-4-5", providerID: "red-router", pinOf: "anthropic/claude-sonnet-4-5" }

    expect(Router.offerGroups([pinned]).map((group) => group.model.id)).toEqual([pinned.id])
  })

  test("resolves pins only within the flat model's provider", () => {
    const flat = {
      id: "jev-1.13",
      providerID: "red-router",
      offers: [offer("zen/jev-1.13", { pinID: "zen@jev-1.13" })],
    }
    const elsewhere = { id: "zen@jev-1.13", providerID: "9router", pinOf: "jev-1.13" }

    const groups = Router.offerGroups([flat, elsewhere])

    expect(groups.map((group) => group.model.id)).toEqual([flat.id, elsewhere.id])
    expect(groups[0]?.offers[0]?.model).toBeUndefined()
  })
})

describe("offerRoute", () => {
  test("names the routers an offer passes through before its provider", () => {
    expect(
      Router.offerRoute(
        offer("red-router/zen/jev-1.13", {
          provider: { id: "zen", name: "OpenCode Zen" },
          via: [{ slug: "red-router", name: "RedRouter" }],
        }),
      ),
    ).toBe("RedRouter » OpenCode Zen")
    expect(Router.offerRoute(offer("zen/jev-1.13", { provider: { id: "zen", name: "OpenCode Zen" } }))).toBe(
      "OpenCode Zen",
    )
  })
})
