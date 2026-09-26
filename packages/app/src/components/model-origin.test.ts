import { describe, expect, test } from "bun:test"
import {
  catalogUpdate,
  flatOffers,
  modelAlternatives,
  modelGroup,
  modelOrigin,
  routerKind,
  routerName,
  routerPath,
} from "./model-origin"

const redRouter = { id: "red-router", name: "RedRouter", router: { kind: "red-router" as const } }
const legacyRedRouter = { id: "red-router", name: "RedRouter" }
const nineRouter = { id: "9router", name: "9Router", router: { kind: "9router" as const } }
const codex = { id: "codex", name: "OpenAI Codex" }
const anthropic = { id: "anthropic", name: "Anthropic" }
const codexUpstream = { id: "codex", slug: "codex", name: "OpenAI Codex", subscription: true }

describe("routerKind", () => {
  test("reads the router recorded on the provider", () => {
    expect(routerKind(redRouter)).toBe("red-router")
    expect(routerKind(nineRouter)).toBe("9router")
    expect(routerKind({ id: "home", router: { kind: "red-router" } })).toBe("red-router")
  })

  test("falls back to the RedRouter id for connections saved before routers were recorded", () => {
    expect(routerKind(legacyRedRouter)).toBe("red-router")
  })

  test("treats providers without a router as direct", () => {
    expect(routerKind(codex)).toBeUndefined()
  })
})

describe("routerName", () => {
  test("names RedRouter and 9Router connections", () => {
    expect(routerName(redRouter)).toBe("RedRouter")
    expect(routerName(legacyRedRouter)).toBe("RedRouter")
    expect(routerName(nineRouter)).toBe("9Router")
    expect(routerName(anthropic)).toBeUndefined()
  })
})

describe("modelOrigin", () => {
  test("reports direct providers as direct", () => {
    expect(modelOrigin({ id: "gpt-5.5", provider: codex })).toEqual({ type: "direct" })
  })

  test("reports the router and the provider behind a routed model", () => {
    expect(modelOrigin({ id: "codex/gpt-5.5", provider: redRouter, upstream: codexUpstream })).toEqual({
      type: "router",
      router: "RedRouter",
      upstream: "OpenAI Codex",
      subscription: true,
      via: undefined,
    })
    expect(modelOrigin({ id: "gpt-5.5", provider: legacyRedRouter })).toEqual({
      type: "router",
      router: "RedRouter",
      upstream: undefined,
      subscription: false,
      via: undefined,
    })
  })
})

describe("modelGroup", () => {
  test("groups routed models by their upstream provider", () => {
    expect(modelGroup({ id: "codex/gpt-5.5", provider: redRouter, upstream: codexUpstream })).toEqual({
      key: "red-router:codex",
      label: "RedRouter » OpenAI Codex",
    })
    expect(
      modelGroup({ id: "smart", provider: redRouter, upstream: { id: "combo", name: "Combo", category: "combo" } }),
    ).toEqual({ key: "red-router:combo", label: "RedRouter » Combo" })
  })

  test("groups direct models and routed models without an upstream by provider", () => {
    expect(modelGroup({ id: "gpt-5.5", provider: codex })).toEqual({ key: "codex", label: "OpenAI Codex" })
    expect(modelGroup({ id: "gpt-5.5", provider: redRouter })).toEqual({ key: "red-router", label: "RedRouter" })
  })
})

describe("modelAlternatives", () => {
  test("pairs a direct model with the same model through RedRouter", () => {
    const result = modelAlternatives([
      { id: "gpt-5.5", provider: codex },
      { id: "codex/gpt-5.5", provider: redRouter, upstream: codexUpstream },
      { id: "claude-opus-5", provider: anthropic },
    ])
    expect(result.get("codex:gpt-5.5")).toEqual({ direct: false, routers: ["RedRouter"] })
    expect(result.get("red-router:codex/gpt-5.5")).toEqual({ direct: true, routers: [] })
    expect(result.has("anthropic:claude-opus-5")).toBe(false)
  })

  test("matches the upstream slug when it differs from the upstream id", () => {
    const result = modelAlternatives([
      { id: "claude-opus-5", provider: anthropic },
      {
        id: "cc/claude-opus-5",
        provider: redRouter,
        upstream: { id: "claude-code", slug: "anthropic", name: "Claude Code" },
      },
    ])
    expect(result.get("anthropic:claude-opus-5")).toEqual({ direct: false, routers: ["RedRouter"] })
    expect(result.get("red-router:cc/claude-opus-5")).toEqual({ direct: true, routers: [] })
  })

  test("ignores models that differ, lack an upstream, or come through 9Router", () => {
    const result = modelAlternatives([
      { id: "gpt-5.5", provider: codex },
      { id: "codex/gpt-5.4", provider: redRouter, upstream: codexUpstream },
      { id: "codex/gpt-5.5", provider: redRouter },
      { id: "codex/gpt-5.5", provider: nineRouter, upstream: codexUpstream },
    ])
    expect(result.size).toBe(0)
  })
})

describe("routerPath", () => {
  test("names the router in between when a remote router serves the model", () => {
    const origin = modelOrigin({ id: "codex/gpt-5.5", provider: redRouter, upstream: codexUpstream, via: "office" })
    expect(origin).toMatchObject({ type: "router", router: "RedRouter", via: "office" })
    expect(routerPath({ router: "RedRouter", via: "office" })).toBe("RedRouter » office")
    expect(routerPath({ router: "RedRouter" })).toBe("RedRouter")
  })
})

describe("catalogUpdate", () => {
  test("announces a refresh that added, removed or renamed models", () => {
    expect(
      catalogUpdate({
        type: "provider.catalog.updated",
        properties: { providerID: "red-router", name: "RedRouter", added: 2, removed: 1, renamed: 0 },
      }),
    ).toEqual({ name: "RedRouter", added: 2, removed: 1, renamed: 0 })
  })

  test("stays quiet when only limits or modes changed, or for other events", () => {
    expect(
      catalogUpdate({
        type: "provider.catalog.updated",
        properties: { providerID: "red-router", name: "RedRouter", added: 0, removed: 0, renamed: 0 },
      }),
    ).toBeUndefined()
    expect(catalogUpdate({ type: "models-dev.refreshed", properties: {} })).toBeUndefined()
  })
})

describe("flat model ids", () => {
  const openrouter = { id: "openrouter", slug: "openrouter", name: "OpenRouter" }
  const anthropicUpstream = { id: "anthropic", slug: "anthropic", name: "Anthropic" }
  const claude = {
    id: "anthropic/claude-sonnet-4-5",
    provider: redRouter,
    flat: true,
    upstream: anthropicUpstream,
    offers: [
      { id: "anthropic/claude-sonnet-4-5", provider: anthropicUpstream, via: [], available: true, free: false },
      {
        id: "openrouter/anthropic/claude-sonnet-4.5",
        pinID: "openrouter/anthropic/claude-sonnet-4.5",
        provider: openrouter,
        via: [{ slug: "red-router", name: "Office RedRouter" }],
        available: true,
        price: { input: 3, output: 15 },
        free: false,
      },
    ],
  }

  test("pairs a flat model with a direct connection through its offers, never through its id", () => {
    const direct = { id: "claude-sonnet-4-5", provider: anthropic }
    const typesafe = { id: "jev-1.13", provider: { id: "typesafe", name: "Typesafe" } }
    const jev = {
      id: "typesafe/jev-1.13",
      provider: redRouter,
      flat: true,
      upstream: openrouter,
      offers: [{ id: "openrouter/typesafe/jev-1.13", provider: openrouter, via: [], available: true, free: false }],
    }
    const result = modelAlternatives([claude, direct, jev, typesafe])
    expect(result.get("anthropic:claude-sonnet-4-5")).toEqual({ direct: false, routers: ["RedRouter"] })
    expect(result.get("red-router:anthropic/claude-sonnet-4-5")).toEqual({ direct: true, routers: [] })
    expect(result.get("typesafe:jev-1.13")).toBeUndefined()
    expect(result.get("red-router:typesafe/jev-1.13")).toBeUndefined()
  })

  test("lists offers with their route and price, and pins only by pin id", () => {
    const rows = flatOffers(claude, (id) => id === "openrouter/anthropic/claude-sonnet-4.5")
    expect(rows.map((row) => [row.route, row.price, row.pin])).toEqual([
      ["RedRouter » Anthropic", undefined, undefined],
      ["RedRouter » Office RedRouter » OpenRouter", "$3/$15", "openrouter/anthropic/claude-sonnet-4.5"],
    ])
    // A pin id with no model listed under it is not offered.
    expect(flatOffers(claude, () => false).map((row) => row.pin)).toEqual([undefined, undefined])
    expect(flatOffers({ ...claude, flat: false }, () => true)).toEqual([])
  })

  test("keeps an offer switched off for the flat id pinnable and marks it off", () => {
    const off = {
      ...claude,
      offers: [
        ...claude.offers,
        {
          id: "nano-gpt/anthropic/claude-sonnet-4.5",
          pinID: "nano-gpt/anthropic/claude-sonnet-4.5",
          provider: { id: "nano-gpt", name: "NanoGPT" },
          via: [],
          available: false,
          free: false,
        },
      ],
    }
    const rows = flatOffers(off, () => true)
    expect(rows.map((row) => [row.route, row.off, row.pin])).toEqual([
      ["RedRouter » Anthropic", false, undefined],
      ["RedRouter » Office RedRouter » OpenRouter", false, "openrouter/anthropic/claude-sonnet-4.5"],
      ["RedRouter » NanoGPT", true, "nano-gpt/anthropic/claude-sonnet-4.5"],
    ])
  })
})
