import { describe, expect, test } from "bun:test"
import type { Message, Model, Part, Provider } from "@reddb-io/redcode-sdk/v2"
import {
  catalogUpdateMessage,
  latestServed,
  migrateModelState,
  modeBadge,
  originCategory,
  originDescription,
  originIndex,
  resolveModel,
  routerLabel,
  servedModel,
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
      "via RedRouter · OpenAI Codex · subscription · also direct",
    )
    expect(originDescription(index, router, router.models.smart)).toBe("via RedRouter · Combo")
    expect(originDescription(index, direct, direct.models["gpt-5.6-sol"])).toBe("direct · also via RedRouter")
    expect(originDescription(index, direct, direct.models["gpt-5.5"])).toBe("direct")
  })

  test("groups routed models per upstream provider", () => {
    expect(originCategory(router, router.models["codex/gpt-5.6-sol"])).toBe("RedRouter · OpenAI Codex")
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
