import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { RouterMCP } from "@reddb-io/redcode-core/provider/router-mcp"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { GlobalBus } from "@/bus/global"
import { Provider } from "@/provider/provider"
import { SessionModelSuggestion } from "@/session/model-suggestion"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const providerID = ProviderV2.ID.make("red-router")

function model(id: string, input: { image?: boolean; toolcall?: boolean; context?: number; pinOf?: string } = {}) {
  return {
    id: ModelV2.ID.make(id),
    providerID,
    api: { id, url: "http://router/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: input.image ?? false,
      toolcall: input.toolcall ?? true,
      input: { text: true, audio: false, image: input.image ?? false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false as const,
    },
    limit: { context: input.context ?? 128_000, output: 8_192 },
    ...(input.pinOf ? { pinOf: input.pinOf } : {}),
  }
}

function recommendation(
  id: string,
  input: {
    capabilities?: string[]
    usable?: boolean
    kind?: string
    lost?: string[]
    pct?: number | null
    offers?: RouterMCP.Offer[]
  } = {},
): RouterMCP.Recommendation {
  return {
    id,
    name: id.toUpperCase(),
    kind: input.kind ?? "model",
    context_length: 200_000,
    capabilities: input.capabilities ?? ["vision", "tools"],
    status: { state: "ok" },
    usable: input.usable ?? true,
    why: [{ code: "vision", detail: "supports vision" }],
    why_text: "supports vision",
    delta: {
      price_delta_pct: input.pct === undefined ? 10 : input.pct,
      context_delta: 72_000,
      gained_capabilities: ["vision"],
      lost_capabilities: input.lost ?? [],
    },
    ...(input.offers ? { offers: input.offers } : {}),
  }
}

const sessionID = SessionID.make("ses_model_suggestion")

function userMessage(parts: Array<{ mime: string }>): SessionV1.WithParts {
  const messageID = MessageID.make("msg_suggestion_user")
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID, modelID: ModelV2.ID.make("text-only") },
    },
    parts: parts.map((part, index) => ({
      id: PartID.make(`prt_suggestion_${index}`),
      sessionID,
      messageID,
      type: "file" as const,
      mime: part.mime,
      filename: "attachment",
      url: "data:,",
    })),
  }
}

describe("SessionModelSuggestion.detect", () => {
  test("images the model cannot see ask for vision, with the session's needs and the current model", () => {
    expect(SessionModelSuggestion.detect({ model: model("text-only"), needs: ["vision", "tools"], usable: 100 })).toEqual(
      { trigger: "vision", args: { needs: ["vision", "tools"], current: "text-only", limit: 5 } },
    )
  })

  test("tools the model cannot call ask for tools", () => {
    expect(
      SessionModelSuggestion.detect({ model: model("no-tools", { toolcall: false }), needs: ["tools"], usable: 100 }),
    ).toEqual({ trigger: "tools", args: { needs: ["tools"], current: "no-tools", limit: 5 } })
  })

  test("a context at 85% of what the model takes asks for a larger one that fits what is in use", () => {
    const current = model("small", { context: 100_000 })
    expect(SessionModelSuggestion.detect({ model: current, needs: [], tokens: 84_000, usable: 100_000 })).toBeUndefined()
    expect(SessionModelSuggestion.detect({ model: current, needs: [], tokens: 85_000, usable: 100_000 })).toEqual({
      trigger: "context",
      args: { needs: [], current: "small", limit: 5, needs_input_tokens: 85_000, min_context: 100_001 },
    })
  })

  test("a pinned offer is asked about as its flat model", () => {
    const pinned = model("pin:claude@zen", { pinOf: "anthropic/claude" })
    expect(SessionModelSuggestion.detect({ model: pinned, needs: ["vision"], usable: 1 })?.args.current).toBe(
      "anthropic/claude",
    )
  })

  test("nothing fires for a capable model with room left", () => {
    expect(
      SessionModelSuggestion.detect({ model: model("capable", { image: true }), needs: ["vision", "tools"], usable: 1 }),
    ).toBeUndefined()
  })
})

describe("SessionModelSuggestion.sessionNeeds", () => {
  test("attached images and PDFs, and tools the step offers, are needs", () => {
    expect(
      SessionModelSuggestion.sessionNeeds({
        messages: [userMessage([{ mime: "image/png" }, { mime: "application/pdf" }])],
        tools: true,
      }),
    ).toEqual(["vision", "pdf", "tools"])
    expect(SessionModelSuggestion.sessionNeeds({ messages: [userMessage([{ mime: "text/plain" }])], tools: false })).toEqual(
      [],
    )
  })
})

describe("SessionModelSuggestion.choose", () => {
  const models = {
    "text-only": model("text-only"),
    "vision-lossy": model("vision-lossy", { image: true, toolcall: false }),
    "vision-model": model("vision-model", { image: true }),
    cheap: model("cheap"),
  }
  const current = models["text-only"]

  test("never suggests one that loses a capability the session needs", () => {
    const chosen = SessionModelSuggestion.choose(
      {
        recommendations: [
          recommendation("vision-lossy", { capabilities: ["vision"], lost: ["tools"] }),
          recommendation("vision-model"),
        ],
      },
      { trigger: "vision", needs: ["vision", "tools"], current, models },
    )
    expect(chosen?.model).toEqual({ providerID: "red-router", modelID: "vision-model" })
    expect(chosen?.current).toEqual({ providerID: "red-router", modelID: "text-only" })
    expect(chosen?.delta).toEqual({ pricePct: 10, context: 72_000, gained: ["vision"], lost: [] })
    expect(chosen?.whyText).toBe("supports vision")
  })

  test("skips what the router cannot serve and what the connection does not list", () => {
    expect(
      SessionModelSuggestion.choose(
        { recommendations: [recommendation("vision-model", { usable: false }), recommendation("unlisted")] },
        { trigger: "vision", needs: ["vision"], current, models },
      ),
    ).toBeUndefined()
  })

  test("a cheaper equivalent costs at least 40% less and loses nothing", () => {
    const choose = (pct: number | null, lost: string[] = []) =>
      SessionModelSuggestion.choose(
        { recommendations: [recommendation("cheap", { capabilities: ["tools"], pct, lost })] },
        { trigger: "cheaper", needs: [], current, models },
      )
    expect(choose(-30)).toBeUndefined()
    expect(choose(null)).toBeUndefined()
    expect(choose(-50, ["pdf"])).toBeUndefined()
    expect(choose(-45)?.model.modelID).toBe("cheap")
  })

  test("an equivalent for failing providers loses nothing either", () => {
    expect(
      SessionModelSuggestion.choose(
        { recommendations: [recommendation("cheap", { capabilities: [], lost: ["reasoning"] })] },
        { trigger: "provider_errors", needs: [], current, models },
      ),
    ).toBeUndefined()
  })

  test("a flat model is suggested by the pin id of an offer when the person pins offers", () => {
    const flat = model("anthropic/claude")
    const pinA = model("pin:claude@zen", { pinOf: "anthropic/claude" })
    const pinB = model("pin:claude@bedrock", { pinOf: "anthropic/claude" })
    const offers = [
      { id: "zen/claude", pin_id: "pin:claude@zen", available: false },
      { id: "bedrock/claude", pin_id: "pin:claude@bedrock", available: true },
    ]
    const listed = { "anthropic/claude": flat, "pin:claude@zen": pinA, "pin:claude@bedrock": pinB, "text-only": current }
    const flatRecommendation = recommendation("anthropic/claude", { kind: "flat", offers })
    // The person uses a pinned offer: the first available offer is pinned again.
    const pinnedCurrent = model("pin:other@zen", { pinOf: "other/model" })
    expect(
      SessionModelSuggestion.choose(
        { recommendations: [flatRecommendation] },
        { trigger: "vision", needs: [], current: pinnedCurrent, models: listed },
      )?.model.modelID,
    ).toBe("pin:claude@bedrock")
    // Otherwise the flat id itself, and the router picks the offer.
    expect(
      SessionModelSuggestion.choose(
        { recommendations: [flatRecommendation] },
        { trigger: "vision", needs: [], current, models: listed },
      )?.model.modelID,
    ).toBe("anthropic/claude")
    // A flat id the connection does not list is selected by an available offer's pin id.
    expect(
      SessionModelSuggestion.targetOf(flatRecommendation, { "pin:claude@bedrock": pinB }, false)?.id,
    ).toBe(ModelV2.ID.make("pin:claude@bedrock"))
  })
})

describe("SessionModelSuggestion.quotasSpent", () => {
  const now = Date.parse("2026-09-25T12:00:00Z")
  const report = (accounts: Array<Array<Partial<RouterMCP.Quota>>>): RouterMCP.Quotas => ({
    providers: [
      {
        provider: "claude",
        accounts: accounts.map((quotas) => ({ quotas: quotas.map((quota) => ({ name: "weekly", ...quota })) })),
      },
    ],
  })

  test("every account nearly used up with a reset far away", () => {
    expect(
      SessionModelSuggestion.quotasSpent(
        report([[{ remaining_pct: 5, reset_at: "2026-09-30T00:00:00Z" }], [{ remaining_pct: 8 }]]),
        "claude",
        now,
      ),
    ).toBe(true)
  })

  test("not when a window resets soon, one account has room, it is unlimited, or nothing reported", () => {
    expect(
      SessionModelSuggestion.quotasSpent(report([[{ remaining_pct: 5, reset_at: "2026-09-25T12:20:00Z" }]]), "claude", now),
    ).toBe(false)
    expect(
      SessionModelSuggestion.quotasSpent(report([[{ remaining_pct: 5 }], [{ remaining_pct: 60 }]]), "claude", now),
    ).toBe(false)
    expect(SessionModelSuggestion.quotasSpent(report([[{ remaining_pct: 0, unlimited: true }]]), "claude", now)).toBe(
      false,
    )
    expect(SessionModelSuggestion.quotasSpent(report([[{ remaining_pct: 1 }]]), "codex", now)).toBe(false)
    expect(SessionModelSuggestion.quotasSpent(undefined, "claude", now)).toBe(false)
  })
})

// A RedRouter whose /v1/mcp speaks `version` (none: no endpoint at all).
const router = {
  server: null as ReturnType<typeof Bun.serve> | null,
  version: 2 as number | undefined,
  calls: [] as Array<{ name: string; arguments: Record<string, unknown> }>,
  initializes: 0,
  quotas: undefined as unknown,
}

const recommended = {
  criteria: {},
  considered: 2,
  recommendations: [
    recommendation("vision-lossy", { capabilities: ["vision"], lost: ["tools"] }),
    recommendation("vision-model"),
  ],
  note: "Suggestions only",
}

beforeAll(() => {
  router.server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/v1/mcp" || router.version === undefined)
        return new Response("not found", { status: 404 })
      const message = (await request.json()) as {
        id: number
        method: string
        params: { name?: string; arguments?: Record<string, unknown> }
      }
      const headers = { [RouterMCP.VERSION_HEADER]: String(router.version) }
      if (message.method === "initialize") {
        router.initializes += 1
        return Response.json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } }, { headers })
      }
      const name = message.params.name ?? ""
      router.calls.push({ name, arguments: message.params.arguments ?? {} })
      const result =
        name === "recommend_models"
          ? recommended
          : name === "get_model"
            ? { model: { ...recommendation("text-only"), provider: { id: "claude", name: "Claude" } } }
            : name === "get_quotas"
              ? router.quotas
              : undefined
      return Response.json({ jsonrpc: "2.0", id: message.id, result: { structuredContent: result } }, { headers })
    },
  })
})

afterEach(() => {
  RouterMCP.forget()
  router.calls = []
  router.initializes = 0
  router.version = 2
  router.quotas = undefined
})

afterAll(() => {
  void router.server?.stop(true)
})

const it = testEffect(AppNodeBuilder.build(LayerNode.group([SessionModelSuggestion.node, Provider.node])))

const routerConfig = (experimental?: { model_suggestions?: boolean }) => () => ({
  enabled_providers: ["red-router"],
  ...(experimental ? { experimental } : {}),
  provider: {
    "red-router": {
      name: "RedRouter",
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "test-key", baseURL: `${router.server!.url.origin}/v1` },
      models: {
        "text-only": { name: "Text only", tool_call: true, limit: { context: 128000, output: 8192 } },
        "other-text": { name: "Other text", tool_call: true, limit: { context: 128000, output: 8192 } },
        "vision-model": {
          name: "Vision model",
          tool_call: true,
          modalities: { input: ["text" as const, "image" as const], output: ["text" as const] },
          limit: { context: 200000, output: 8192 },
        },
      },
    },
  },
})

/** Collects suggestion events published while `body` runs. */
function listen() {
  const seen: Array<{ type: string; properties: unknown }> = []
  const listener = (event: { payload: { type?: string; properties?: unknown } }) => {
    if (event.payload.type?.startsWith("session.model.suggest"))
      seen.push({ type: event.payload.type, properties: event.payload.properties })
  }
  GlobalBus.on("event", listener)
  return { seen, stop: () => GlobalBus.off("event", listener) }
}

const until = (check: () => boolean, ms = 3_000) =>
  Effect.promise(async () => {
    const deadline = Date.now() + ms
    while (!check() && Date.now() < deadline) await Bun.sleep(10)
    return check()
  })

const settle = Effect.promise(() => Bun.sleep(150))

const getModel = (id: string) => Provider.use.getModel(providerID, ModelV2.ID.make(id))

describe("SessionModelSuggestion service", () => {
  it.instance(
    "an image the model cannot see asks the router and suggests a vision model that keeps tools",
    () =>
      Effect.gen(function* () {
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        const current = yield* getModel("text-only")
        yield* suggestions.observe({
          sessionID,
          model: current,
          messages: [userMessage([{ mime: "image/png" }])],
          tools: true,
          usable: 100_000,
        })
        expect(yield* until(() => events.seen.length > 0)).toBe(true)
        expect(router.calls).toEqual([
          {
            name: "recommend_models",
            arguments: { needs: ["vision", "tools"], current: "text-only", limit: 5 },
          },
        ])
        const suggested = events.seen[0]?.properties as { sessionID: string; suggestion: ModelSuggestion.Info }
        expect(events.seen[0]?.type).toBe("session.model.suggested")
        expect(suggested.sessionID).toBe(sessionID)
        expect(suggested.suggestion.trigger).toBe("vision")
        expect(suggested.suggestion.model).toEqual({ providerID: "red-router", modelID: "vision-model" })

        // The same situation is not asked about again.
        yield* suggestions.observe({
          sessionID,
          model: current,
          messages: [userMessage([{ mime: "image/png" }])],
          tools: true,
          usable: 100_000,
        })
        yield* settle
        expect(router.calls.filter((call) => call.name === "recommend_models")).toHaveLength(1)
      }),
    { config: routerConfig() },
  )

  it.instance(
    "keep silences the trigger for the session, even when the situation changes",
    () =>
      Effect.gen(function* () {
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        const messages = [userMessage([{ mime: "image/jpeg" }])]
        yield* suggestions.observe({ sessionID, model: yield* getModel("text-only"), messages, tools: false, usable: 1 })
        expect(yield* until(() => events.seen.length > 0)).toBe(true)
        yield* suggestions.resolve({ sessionID, trigger: "vision", choice: "keep" })
        expect(events.seen.at(-1)).toEqual({
          type: "session.model.suggestion.resolved",
          properties: { sessionID, trigger: "vision", choice: "keep" },
        })
        yield* suggestions.observe({ sessionID, model: yield* getModel("other-text"), messages, tools: false, usable: 1 })
        yield* settle
        expect(router.calls.filter((call) => call.name === "recommend_models")).toHaveLength(1)
        expect(events.seen.filter((event) => event.type === "session.model.suggested")).toHaveLength(1)
      }),
    { config: routerConfig() },
  )

  it.instance(
    "switch only answers the card: the service never changes the model",
    () =>
      Effect.gen(function* () {
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.resolve({ sessionID, trigger: "vision", choice: "switch" })
        expect(events.seen).toEqual([
          {
            type: "session.model.suggestion.resolved",
            properties: { sessionID, trigger: "vision", choice: "switch" },
          },
        ])
      }),
    { config: routerConfig() },
  )

  it.instance(
    "repeated provider failures ask for an equivalent of the current model",
    () =>
      Effect.gen(function* () {
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        const current = yield* getModel("text-only")
        // A 400 is the request's fault, not the provider's.
        yield* suggestions.failure({ sessionID, model: current, status: 400 })
        yield* suggestions.failure({ sessionID, model: current, status: 429 })
        expect(yield* until(() => router.calls.some((call) => call.name === "get_model"))).toBe(true)
        yield* suggestions.failure({ sessionID, model: current, status: 503 })
        expect(yield* until(() => router.calls.some((call) => call.name === "recommend_models"))).toBe(true)
        expect(router.calls.find((call) => call.name === "recommend_models")?.arguments).toEqual({
          needs: [],
          current: "text-only",
          equivalent_to: "text-only",
          prefer: "cheapest",
          limit: 5,
        })
      }),
    { config: routerConfig() },
  )

  it.instance(
    "a quota exhausted until far off asks for an equivalent at once, with the reset as its reason",
    () =>
      Effect.gen(function* () {
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.failure({
          sessionID,
          model: yield* getModel("text-only"),
          status: 429,
          until: Date.now() + 3_600_000,
        })
        expect(yield* until(() => events.seen.some((event) => event.type === "session.model.suggested"))).toBe(true)
        // No health check first: the failure already says the model cannot serve.
        expect(router.calls.map((call) => call.name)).toEqual(["recommend_models"])
        expect(router.calls[0]?.arguments).toMatchObject({ equivalent_to: "text-only" })
        const suggested = events.seen[0]?.properties as { suggestion: ModelSuggestion.Info }
        expect(suggested.suggestion.trigger).toBe("provider_errors")
        expect(suggested.suggestion.model).toEqual({ providerID: "red-router", modelID: "vision-model" })
        expect(suggested.suggestion.why[0]?.code).toBe("quota")
        expect(suggested.suggestion.whyText).toStartWith("quota exhausted until ")
      }),
    { config: routerConfig() },
  )

  it.instance(
    "a schema 3 router whose quotas for the model's provider are nearly used up asks for an equivalent",
    () =>
      Effect.gen(function* () {
        router.version = 3
        router.quotas = {
          total_accounts: 1,
          providers: [
            {
              provider: "claude",
              accounts: [{ quotas: [{ name: "weekly", remaining_pct: 4, unlimited: false, reset_at: null }] }],
            },
          ],
        }
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.observe({
          sessionID,
          model: yield* getModel("text-only"),
          messages: [],
          tools: true,
          usable: 100_000,
        })
        expect(yield* until(() => router.calls.some((call) => call.name === "recommend_models"))).toBe(true)
        expect(router.calls.map((call) => call.name)).toEqual(["get_model", "get_quotas", "recommend_models"])
        expect(router.calls[1]?.arguments).toEqual({ provider: "claude" })
        expect(router.calls[2]?.arguments).toMatchObject({ equivalent_to: "text-only" })
      }),
    { config: routerConfig() },
  )

  it.instance(
    "a schema 2 router is never asked for quotas",
    () =>
      Effect.gen(function* () {
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.observe({
          sessionID,
          model: yield* getModel("text-only"),
          messages: [],
          tools: true,
          usable: 100_000,
        })
        yield* settle
        expect(router.initializes).toBe(1)
        expect(router.calls).toEqual([])
      }),
    { config: routerConfig() },
  )

  it.instance(
    "a router without MCP suggests nothing",
    () =>
      Effect.gen(function* () {
        router.version = undefined
        const events = listen()
        yield* Effect.addFinalizer(() => Effect.sync(events.stop))
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.observe({
          sessionID,
          model: yield* getModel("text-only"),
          messages: [userMessage([{ mime: "image/png" }])],
          tools: true,
          usable: 1,
        })
        yield* settle
        expect(router.calls).toEqual([])
        expect(events.seen).toEqual([])
      }),
    { config: routerConfig() },
  )

  it.instance(
    "experimental.model_suggestions false never reaches the router",
    () =>
      Effect.gen(function* () {
        const suggestions = yield* SessionModelSuggestion.Service
        yield* suggestions.observe({
          sessionID,
          model: yield* getModel("text-only"),
          messages: [userMessage([{ mime: "image/png" }])],
          tools: true,
          usable: 1,
        })
        yield* settle
        expect(router.initializes).toBe(0)
        expect(router.calls).toEqual([])
      }),
    { config: routerConfig({ model_suggestions: false }) },
  )
})
