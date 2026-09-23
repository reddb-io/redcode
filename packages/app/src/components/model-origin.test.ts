import { describe, expect, test } from "bun:test"
import {
  catalogUpdate,
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
      label: "RedRouter · OpenAI Codex",
    })
    expect(
      modelGroup({ id: "smart", provider: redRouter, upstream: { id: "combo", name: "Combo", category: "combo" } }),
    ).toEqual({ key: "red-router:combo", label: "RedRouter · Combo" })
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
    expect(routerPath({ router: "RedRouter", via: "office" })).toBe("RedRouter → office")
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
