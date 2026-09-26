import { describe, expect, test } from "bun:test"
import type { Message, Model, Part, Provider } from "@reddb-io/redcode-sdk/v2"
import {
  catalogUpdateMessage,
  flatOffers,
  latestServed,
  migrateModelState,
  missingModelMessage,
  modeBadge,
  modeID,
  originCategory,
  originDescription,
  originIndex,
  resolveModel,
  routeLabel,
  routerLabel,
  servedModel,
  servedRoute,
  servingVariants,
} from "../../src/util/model-origin"

function model(providerID: string, id: string, extra: Partial<Model> = {}): Model {
  const media = { text: true, audio: false, image: false, video: false, pdf: false }
  return {
    id,
    providerID,
    api: { id, url: "", npm: "" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: media,
      output: media,
      interleaved: false,
    },
    cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    limit: { context: 1000, output: 100 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    ...extra,
  }
}

function provider(id: string, name: string, models: Model[], extra: Partial<Provider> = {}): Provider {
  return {
    id,
    name,
    source: "config",
    env: [],
    options: {},
    models: Object.fromEntries(models.map((item) => [item.id, item])),
    ...extra,
  }
}

const codex = { id: "codex", slug: "codex", name: "OpenAI Codex", subscription: true }
const router = provider(
  "red-router",
  "RedRouter",
  [
    model("red-router", "codex/gpt-5.6-sol", {
      upstream: codex,
      aliases: ["cx/gpt-5.6-sol"],
      modes: ["review"],
      variants: { low: {}, high: {} },
      routerVariants: [{ id: "codex/gpt-5.6-sol-high", level: "high", aliases: ["cx/gpt-5.6-sol-high"] }],
    }),
    model("red-router", "smart", { upstream: { id: "combo", name: "Combo", category: "combo" } }),
  ],
  { router: { kind: "red-router" } },
)
const direct = provider("codex", "OpenAI Codex", [model("codex", "gpt-5.6-sol"), model("codex", "gpt-5.5")])

describe("model origin", () => {
  test("names the router of a connection, including configs saved before connections recorded it", () => {
    expect(routerLabel(router)).toBe("RedRouter")
    expect(routerLabel({ id: "red-router" })).toBe("RedRouter")
    expect(routerLabel({ id: "nine", router: { kind: "9router" } })).toBe("9Router")
    expect(routerLabel(direct)).toBeUndefined()
  })

  test("describes routed and direct models and the other connections serving them", () => {
    const index = originIndex([router, direct])
    expect(originDescription(index, router, router.models["codex/gpt-5.6-sol"])).toBe(
      "via RedRouter » OpenAI Codex · subscription · also direct",
    )
    expect(originDescription(index, router, router.models.smart)).toBe("via RedRouter » Combo")
    expect(originDescription(index, direct, direct.models["gpt-5.6-sol"])).toBe("direct · also via RedRouter")
    expect(originDescription(index, direct, direct.models["gpt-5.5"])).toBe("direct")
  })

  test("groups routed models per upstream provider", () => {
    expect(originCategory(router, router.models["codex/gpt-5.6-sol"])).toBe("RedRouter » OpenAI Codex")
    expect(originCategory(direct, direct.models["gpt-5.5"])).toBe("OpenAI Codex")
  })

  test("shows router modes as a badge", () => {
    expect(modeBadge(router.models["codex/gpt-5.6-sol"])).toBe("review")
    expect(modeBadge(direct.models["gpt-5.5"])).toBeUndefined()
  })

  test("reports the served model only when it differs from the requested one", () => {
    const finish = (served?: string): Part => ({
      id: "prt",
      sessionID: "ses",
      messageID: "msg",
      type: "step-finish",
      reason: "stop",
      servedModel: served,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const message = { providerID: "red-router", modelID: "smart" }
    expect(servedModel(message, [finish(), finish("codex/gpt-5.6-sol")])).toBe("codex/gpt-5.6-sol")
    expect(servedModel(message, [finish("smart")])).toBeUndefined()
    expect(servedModel(message, [finish("red-router/smart")])).toBeUndefined()
    expect(servedModel(message, [])).toBeUndefined()
    const routed = { providerID: "red-router", modelID: "codex/gpt-5.6-sol" }
    expect(servedModel(routed, [finish("gpt-5.6-sol")])).toBeUndefined()
  })

  test("resolves earlier ids and collapsed reasoning levels to the current model", () => {
    expect(resolveModel(router, "codex/gpt-5.6-sol")).toEqual({ modelID: "codex/gpt-5.6-sol", level: undefined })
    expect(resolveModel(router, "cx/gpt-5.6-sol")).toEqual({ modelID: "codex/gpt-5.6-sol", level: undefined })
    expect(resolveModel(router, "cx/gpt-5.6-sol-high")).toEqual({ modelID: "codex/gpt-5.6-sol", level: "high" })
    expect(resolveModel(router, "missing")).toBeUndefined()
    // A collapsed mode is kept as the variant the base model offers for it.
    const reviewing = provider(
      "red-router",
      "RedRouter",
      [
        model("red-router", "codex/gpt-5.6-sol", {
          modes: ["review"],
          variants: { review: {} },
          routerVariants: [{ id: "codex/gpt-5.6-sol-review", mode: "review", aliases: ["cx/gpt-5.6-sol-review"] }],
        }),
      ],
      { router: { kind: "red-router" } },
    )
    expect(resolveModel(reviewing, "cx/gpt-5.6-sol-review")).toEqual({ modelID: "codex/gpt-5.6-sol", level: "review" })
    expect(resolveModel(undefined, "cx/gpt-5.6-sol")).toBeUndefined()
  })

  test("migrates saved favorites, recents, agent choices and variants to renamed ids", () => {
    const migrated = migrateModelState([router, direct], {
      model: { build: { providerID: "red-router", modelID: "cx/gpt-5.6-sol" } },
      recent: [
        { providerID: "red-router", modelID: "cx/gpt-5.6-sol-high" },
        { providerID: "red-router", modelID: "codex/gpt-5.6-sol" },
        { providerID: "codex", modelID: "gpt-5.5" },
        { providerID: "gone", modelID: "old" },
      ],
      favorite: [{ providerID: "red-router", modelID: "cx/gpt-5.6-sol" }],
      variant: { "red-router/cx/gpt-5.6-sol": "low", "codex/gpt-5.5": "high" },
    })
    expect(migrated).toEqual({
      model: { build: { providerID: "red-router", modelID: "codex/gpt-5.6-sol" } },
      recent: [
        { providerID: "red-router", modelID: "codex/gpt-5.6-sol" },
        { providerID: "codex", modelID: "gpt-5.5" },
        { providerID: "gone", modelID: "old" },
      ],
      favorite: [{ providerID: "red-router", modelID: "codex/gpt-5.6-sol" }],
      variant: { "red-router/codex/gpt-5.6-sol": "low", "codex/gpt-5.5": "high" },
    })
  })

  test("keeps a choice saved under the current id and carries a collapsed level over otherwise", () => {
    expect(
      migrateModelState([router], {
        model: {},
        recent: [],
        favorite: [],
        variant: { "red-router/cx/gpt-5.6-sol": "low", "red-router/codex/gpt-5.6-sol": "high" },
      })?.variant,
    ).toEqual({ "red-router/codex/gpt-5.6-sol": "high" })
    expect(
      migrateModelState([router], {
        model: {},
        recent: [{ providerID: "red-router", modelID: "cx/gpt-5.6-sol-high" }],
        favorite: [],
        variant: {},
      })?.variant,
    ).toEqual({ "red-router/codex/gpt-5.6-sol": "high" })
  })

  test("leaves saved choices alone when nothing was renamed", () => {
    expect(
      migrateModelState([router, direct], {
        model: {},
        recent: [{ providerID: "codex", modelID: "gpt-5.5" }],
        favorite: [{ providerID: "red-router", modelID: "codex/gpt-5.6-sol" }],
        variant: { "codex/gpt-5.5": "high", legacy: "low" },
      }),
    ).toBeUndefined()
  })

  test("announces catalog refreshes with added, removed and renamed counts", () => {
    expect(catalogUpdateMessage({ name: "RedRouter", added: 2, removed: 1, renamed: 0 })).toBe(
      "RedRouter catalog updated: +2/−1 models",
    )
    expect(catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 3 })).toBe(
      "RedRouter catalog updated: +0/−0 models, 3 renamed",
    )
    // Only limits or modes changed: nothing to announce.
    expect(catalogUpdateMessage({ name: "RedRouter", added: 0, removed: 0, renamed: 0 })).toBeUndefined()
  })

  test("names the router a remote router serves a model through", () => {
    const remote = provider(
      "red-router",
      "RedRouter",
      [model("red-router", "codex/gpt-5.6-sol", { upstream: codex, via: "office" })],
      { router: { kind: "red-router" } },
    )
    expect(originDescription(originIndex([remote]), remote, remote.models["codex/gpt-5.6-sol"])).toBe(
      "via RedRouter » office » OpenAI Codex · subscription",
    )
  })

  test("names every router hop of a nested routed id and matches its direct twin", () => {
    // A RedRouter connected to another RedRouter, which is connected to a third: any depth.
    const chained = provider(
      "red-router",
      "RedRouter",
      [
        model("red-router", "red-router/codex/gpt-5.6-sol", { upstream: codex }),
        model("red-router", "red-router/red-router/codex/gpt-5.5", { upstream: codex }),
      ],
      { router: { kind: "red-router" } },
    )
    const index = originIndex([chained, direct])
    expect(originDescription(index, chained, chained.models["red-router/codex/gpt-5.6-sol"])).toBe(
      "via RedRouter » RedRouter » OpenAI Codex · subscription · also direct",
    )
    expect(originDescription(index, chained, chained.models["red-router/red-router/codex/gpt-5.5"])).toBe(
      "via RedRouter » RedRouter » RedRouter » OpenAI Codex · subscription · also direct",
    )
    expect(originDescription(index, direct, direct.models["gpt-5.5"])).toBe("direct · also via RedRouter")
  })

  test("a router mode chosen as the variant requests the router's id for it", () => {
    const sol = model("red-router", "codex/gpt-5.6-sol", {
      modes: ["review"],
      routerVariants: [{ id: "codex/gpt-5.6-sol-review", mode: "review" }],
    })
    expect(modeID(sol, "review")).toBe("codex/gpt-5.6-sol-review")
    expect(modeID({ ...sol, routerVariants: undefined }, "review")).toBe("codex/gpt-5.6-sol-review")
    expect(modeID(sol, "high")).toBeUndefined()
  })

  test("follows the variants of the fallback combo member that served the session last", () => {
    const assistant = (id: string, modelID: string): Message => ({
      id,
      sessionID: "ses",
      role: "assistant",
      time: { created: 0 },
      parentID: "msg_user",
      modelID,
      providerID: "red-router",
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const finish = (messageID: string, served?: string): Part => ({
      id: `prt_${messageID}`,
      sessionID: "ses",
      messageID,
      type: "step-finish",
      reason: "stop",
      ...(served ? { servedModel: served } : {}),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const parts: Record<string, Part[]> = {
      one: [finish("one", "cc/other")],
      two: [finish("two")],
      three: [finish("three", "cc/lead")],
    }
    const fast = { providerID: "red-router", modelID: "fast" }
    const messages = [assistant("one", "fast"), assistant("two", "fast"), assistant("three", "slow")]
    expect(latestServed(messages, (id) => parts[id] ?? [], fast)).toBe("cc/other")
    expect(latestServed([], (id) => parts[id] ?? [], fast)).toBeUndefined()

    const combo = model("red-router", "fast", {
      comboMembers: [
        { id: "cc/lead", variants: ["none", "low", "high"] },
        { id: "cc/other", variants: ["low", "medium"] },
      ],
    })
    expect(servingVariants(combo, "cc/other")).toEqual(["low", "medium"])
    expect(servingVariants(combo, "other")).toEqual(["low", "medium"])
    // The lead, an unlisted member, no report and a combo without members keep the model's own variants.
    expect(servingVariants(combo, "cc/lead")).toBeUndefined()
    expect(servingVariants(combo, "cc/third")).toBeUndefined()
    expect(servingVariants(combo, undefined)).toBeUndefined()
    expect(servingVariants(model("red-router", "smart"), "cc/other")).toBeUndefined()
  })
})

describe("flat model ids", () => {
  const anthropic = { id: "anthropic", slug: "anthropic", name: "Anthropic", category: "apikey", subscription: false }
  const openrouter = { id: "openrouter", slug: "openrouter", name: "OpenRouter", category: "freeTier" }
  const opencodeGo = { id: "opencode-go", slug: "opencode-go", name: "OpenCode Go" }
  const offices = [
    { slug: "red-router", name: "RedRouter" },
    { slug: "red-router", name: "Office RedRouter" },
  ]
  // As the server lists them: upstream and via are the lead offer's, pinnable offers are models too.
  const claude = model("red-router", "anthropic/claude-sonnet-4-5", {
    name: "Claude Sonnet 4.5",
    flat: true,
    upstream: anthropic,
    offers: [
      { id: "anthropic/claude-sonnet-4-5", provider: anthropic, via: [], available: true, price: { input: 3, output: 15 }, free: false },
      {
        id: "openrouter/anthropic/claude-sonnet-4.5",
        pinID: "openrouter/anthropic/claude-sonnet-4.5",
        provider: openrouter,
        via: [],
        available: true,
        price: { input: 3, output: 15 },
        free: false,
      },
    ],
  })
  const pinned = model("red-router", "openrouter/anthropic/claude-sonnet-4.5", {
    name: "Claude Sonnet 4.5",
    upstream: openrouter,
    pinOf: "anthropic/claude-sonnet-4-5",
  })
  const jev = model("red-router", "typesafe/jev-1.13", {
    name: "JEV 1.13",
    flat: true,
    upstream: opencodeGo,
    via: "RedRouter » Office RedRouter",
    offers: [
      {
        id: "red-router/red-router/opencode-go/typesafe/jev-1.13",
        pinID: "red-router/red-router/opencode-go/typesafe/jev-1.13",
        provider: opencodeGo,
        via: offices,
        available: true,
        price: { input: 0.042, output: 0 },
        free: false,
      },
      { id: "openrouter/typesafe/jev-1.13", provider: openrouter, via: [], available: true, free: true },
    ],
    comboMembers: [
      { id: "red-router/red-router/opencode-go/typesafe/jev-1.13", variants: ["low"] },
      { id: "openrouter/typesafe/jev-1.13", variants: ["low", "high"] },
    ],
  })
  const flat = provider("red-router", "RedRouter", [claude, pinned, jev], { router: { kind: "red-router" } })
  const anthropicDirect = provider("anthropic", "Anthropic", [model("anthropic", "claude-sonnet-4-5")])
  // A direct provider whose id is the flat id's vendor: a flat id must never be paired with it.
  const typesafeDirect = provider("typesafe", "Typesafe", [model("typesafe", "jev-1.13")])

  test("labels a flat model by the offer that serves it, never by a provider read from its id", () => {
    const index = originIndex([flat, anthropicDirect, typesafeDirect])
    expect(routeLabel(flat, jev)).toBe("via RedRouter » RedRouter » Office RedRouter")
    expect(originDescription(index, flat, jev)).toBe("via RedRouter » RedRouter » Office RedRouter » OpenCode Go · 2 offers")
    expect(originCategory(flat, jev)).toBe("RedRouter » OpenCode Go")
    expect(originDescription(index, flat, jev)).not.toContain("typesafe")
    // Without a reported route, the hops come from the lead offer's id, not from the flat id.
    const chained = { ...jev, via: undefined, offers: [{ ...jev.offers![0], via: [] }] }
    expect(routeLabel(flat, chained)).toBe("via RedRouter » RedRouter » RedRouter")
  })

  test("pairs a flat model with a direct connection through its offers only", () => {
    const index = originIndex([flat, anthropicDirect, typesafeDirect])
    expect(index.also(flat, claude)).toEqual(["direct"])
    expect(index.also(anthropicDirect, anthropicDirect.models["claude-sonnet-4-5"])).toEqual(["RedRouter"])
    expect(index.also(flat, jev)).toEqual([])
    expect(index.also(typesafeDirect, typesafeDirect.models["jev-1.13"])).toEqual([])
  })

  test("lists the offers with their route, price and pin id; an offer without one cannot be pinned", () => {
    expect(flatOffers(flat, claude).map((row) => ({ route: row.route, detail: row.detail, pin: row.pin }))).toEqual([
      { route: "RedRouter » Anthropic", detail: "$3/$15 per 1M · cannot be pinned", pin: undefined },
      {
        route: "RedRouter » OpenRouter",
        detail: "$3/$15 per 1M",
        pin: "openrouter/anthropic/claude-sonnet-4.5",
      },
    ])
    // A pin id with no model listed under it is not offered either.
    expect(flatOffers(flat, jev).map((row) => [row.route, row.pin, row.offer.free])).toEqual([
      ["RedRouter » RedRouter » Office RedRouter » OpenCode Go", undefined, false],
      ["RedRouter » OpenRouter", undefined, true],
    ])
    expect(flatOffers(flat, pinned)).toEqual([])
  })

  test("follows the serving offer by its exact id and names it by its route", () => {
    expect(servingVariants(jev, "openrouter/typesafe/jev-1.13")).toEqual(["low", "high"])
    expect(servingVariants(jev, "openrouter/typesafe/jev-1.13(high)")).toEqual(["low", "high"])
    expect(servingVariants(jev, "red-router/red-router/opencode-go/typesafe/jev-1.13")).toBeUndefined()
    // The flat id itself is no member: suffix matching would have read it as the lead.
    expect(servingVariants(jev, "typesafe/jev-1.13")).toBeUndefined()

    const finish = (served: string): Part => ({
      id: "prt",
      sessionID: "ses",
      messageID: "msg",
      type: "step-finish",
      reason: "stop",
      servedModel: served,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const message = { providerID: "red-router", modelID: "anthropic/claude-sonnet-4-5" }
    // The vendor's own offer shares the flat id, and is still news for a flat model.
    expect(servedModel(message, [finish("anthropic/claude-sonnet-4-5")])).toBeUndefined()
    expect(servedModel(message, [finish("anthropic/claude-sonnet-4-5")], true)).toBe("anthropic/claude-sonnet-4-5")
    expect(servedRoute(claude, "anthropic/claude-sonnet-4-5")).toBe("Anthropic · claude-sonnet-4-5")
    expect(servedRoute(claude, "openrouter/anthropic/claude-sonnet-4.5")).toBe("OpenRouter · anthropic/claude-sonnet-4.5")
    expect(servedRoute(jev, "red-router/red-router/opencode-go/typesafe/jev-1.13")).toBe(
      "RedRouter » Office RedRouter » OpenCode Go · typesafe/jev-1.13",
    )
    // An offer the model does not list is read from its chained id.
    expect(servedRoute(jev, "red-router/opencode-zen/jev-1.13")).toBe("RedRouter » opencode-zen · jev-1.13")
  })

  test("greys an offer switched off for the flat id but keeps it pinnable, and says when the order is custom", () => {
    const off = model("red-router", "nano-gpt/typesafe/jev-1.13", { upstream: openrouter, pinOf: "typesafe/jev-1.13" })
    const custom = {
      ...jev,
      offerOrder: "custom" as const,
      offers: [
        ...jev.offers!,
        {
          id: "nano-gpt/typesafe/jev-1.13",
          pinID: "nano-gpt/typesafe/jev-1.13",
          provider: { id: "nano-gpt", name: "NanoGPT" },
          via: [],
          available: false,
          price: { input: 0.04, output: 0 },
          free: false,
        },
      ],
    }
    const connection = provider("red-router", "RedRouter", [custom, off], { router: { kind: "red-router" } })
    const row = flatOffers(connection, custom).at(-1)
    expect(row).toMatchObject({ route: "RedRouter » NanoGPT", off: true, pin: "nano-gpt/typesafe/jev-1.13" })
    expect(row?.detail).toBe("off · $0.04/$0 per 1M")
    expect(flatOffers(connection, custom)[0].off).toBe(false)
    expect(originDescription(originIndex([connection]), connection, custom)).toBe(
      "via RedRouter » RedRouter » Office RedRouter » OpenCode Go · 3 offers · custom order",
    )
    expect(originDescription(originIndex([flat]), flat, jev)).not.toContain("custom order")
  })

  test("says why a saved choice its provider no longer lists is not used", () => {
    const saved = { providerID: "red-router", modelID: "typesafe/jev-1.14" }
    expect(missingModelMessage([flat], saved, { providerID: "red-router", modelID: "typesafe/jev-1.13" })).toBe(
      "RedRouter no longer lists typesafe/jev-1.14: it was removed, or all its offers were switched off. Using red-router/typesafe/jev-1.13 instead. Pick another model with /model.",
    )
    expect(missingModelMessage([anthropicDirect], { providerID: "anthropic", modelID: "gone" }, undefined)).toBe(
      "Anthropic no longer lists gone. Pick another model with /model.",
    )
    expect(missingModelMessage([], saved, undefined)).toBe(
      "red-router is not connected, so typesafe/jev-1.14 is unavailable. Pick another model with /model.",
    )
  })
})
