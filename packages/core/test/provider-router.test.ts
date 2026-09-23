import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Router } from "@reddb-io/redcode-schema/router"
import { ProviderRouter } from "../src/provider/router"

const capabilities = {
  product: "red-router",
  version: "3.2.0",
  instance_id: "rr_fixture",
  systemone: { endpoint: "/v1/systemone", available: true, models: ["jev/jev-latest"] },
  combos: { strategies: ["fallback", "round-robin", "fusion", "smart", "auto"] },
  decision: {
    mode: "auto",
    tool_mode: "auto",
    effort: false,
    header: "x-red-router-decision",
    accepts_hint: true,
    hint_header: "x-red-router-hint",
    hint_keys: ["complexity", "deliberation", "needs_tool", "tier"],
  },
  session: {
    headers: ["x-session-id"],
    per_session_stickiness: true,
    affinity_headers: ["x-parent-session-id", "x-session-affinity"],
    affinity_ttl_ms: 1_800_000,
    prompt_cache_key: true,
  },
  token_saver_header: "x-red-router-token-saver",
  served_model_header: "X-RedRouter-Served-Model",
  cost_header: "X-RedRouter-Cost-USD",
  request_id_header: "X-Request-Id",
  stream_usage_cost: true,
}

const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  ProviderRouter.forget()
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

function serve(routes: Record<string, (request: Request) => Response | Promise<Response>>) {
  const hits: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      hits.push(`${path} ${request.headers.get("authorization") ?? "-"}`)
      return routes[path]?.(request) ?? new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, port: server.port, hits }
}

describe("ProviderRouter.detect", () => {
  test("reads RedRouter's capabilities with the key and caches them per address and key", async () => {
    const router = serve({ "/v1/capabilities": () => Response.json(capabilities) })
    const detection = await Effect.runPromise(ProviderRouter.detect({ baseURL: router.baseURL, apiKey: "sk-one" }))
    expect(detection).toMatchObject({
      kind: "red-router",
      version: "3.2.0",
      instanceID: "rr_fixture",
      systemOne: { available: true, models: ["jev/jev-latest"] },
    })
    expect(detection.features).toEqual([
      "capabilities",
      "systemone",
      "combos",
      "decision",
      "hint",
      "token-saver",
      "session-affinity",
      "served-model",
      "cost",
      "stream-usage-cost",
    ])
    expect(router.hits).toEqual(["/v1/capabilities Bearer sk-one"])

    await Effect.runPromise(ProviderRouter.detect({ baseURL: `${router.baseURL}/`, apiKey: "sk-one" }))
    expect(router.hits).toHaveLength(1)
    // localhost and 127.0.0.1 are one address.
    await Effect.runPromise(ProviderRouter.detect({ baseURL: `http://localhost:${router.port}/v1`, apiKey: "sk-one" }))
    expect(router.hits).toHaveLength(1)
    await Effect.runPromise(ProviderRouter.detect({ baseURL: router.baseURL, apiKey: "sk-two" }))
    expect(router.hits).toHaveLength(2)
    await Effect.runPromise(ProviderRouter.detect({ baseURL: router.baseURL, apiKey: "sk-one", fresh: true }))
    expect(router.hits).toHaveLength(3)
    expect(ProviderRouter.known(`http://localhost:${router.port}/v1`)?.kind).toBe("red-router")
  })

  test("records the catalog version and the catalog feature a RedRouter advertises", async () => {
    const router = serve({
      "/v1/capabilities": () =>
        Response.json({
          ...capabilities,
          catalog: {
            version: "0123456789abcdef",
            version_header: "X-RedRouter-Catalog-Version",
            model_endpoint: "/v1/models/{id}",
            model_parameters: true,
            combo_members: true,
          },
        }),
    })
    const detection = await Effect.runPromise(ProviderRouter.detect({ baseURL: router.baseURL, apiKey: "k" }))
    expect(detection.catalogVersion).toBe("0123456789abcdef")
    expect(detection.features).toContain("catalog")

    const older = serve({ "/v1/capabilities": () => Response.json({ ...capabilities, catalog: { version: "" } }) })
    const without = await Effect.runPromise(ProviderRouter.detect({ baseURL: older.baseURL, apiKey: "k" }))
    expect(without.catalogVersion).toBeUndefined()
    expect(without.features).not.toContain("catalog")
  })

  test("records the reasoning autopilot contract a RedRouter advertises", async () => {
    const router = serve({
      "/v1/capabilities": () =>
        Response.json({
          ...capabilities,
          decision: {
            ...capabilities.decision,
            hint_keys: [
              "complexity",
              "deliberation",
              "needs_tool",
              "tier",
              "effort",
              "stall",
              "feedback",
              "frustration",
            ],
          },
          reasoning: {
            mode: "off",
            header: "x-red-router-reasoning",
            response_header: "X-RedRouter-Reasoning",
            applies: false,
            floor: "low",
            ceiling: "high",
            accepts: ["off", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"],
            ladder: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
          },
        }),
    })
    const detection = await Effect.runPromise(ProviderRouter.detect({ baseURL: router.baseURL, apiKey: "k" }))
    expect(detection.features).toEqual(expect.arrayContaining(["reasoning", "reasoning-auto", "hint-signals"]))
    expect(detection.features).not.toContain("reasoning-applies")

    // A build before the auto contract: the header is read, `auto` is not, and its autopilot covers the key.
    const older = serve({
      "/v1/capabilities": () =>
        Response.json({
          ...capabilities,
          reasoning: { mode: "enforce", header: "x-red-router-reasoning", applies: true },
        }),
    })
    const before = await Effect.runPromise(ProviderRouter.detect({ baseURL: older.baseURL, apiKey: "k" }))
    expect(before.features).toEqual(expect.arrayContaining(["reasoning", "reasoning-applies"]))
    expect(before.features).not.toContain("reasoning-auto")
    expect(before.features).not.toContain("hint-signals")
  })

  test("falls back to the System One catalog, then to the public version fingerprint", async () => {
    const older = serve({
      "/v1/models/systemone": () => Response.json({ object: "list", data: [{ id: "jev/jev-latest" }] }),
    })
    expect(await Effect.runPromise(ProviderRouter.detect({ baseURL: older.baseURL, apiKey: "k" }))).toMatchObject({
      kind: "red-router",
      features: ["systemone"],
      systemOne: { available: true, models: ["jev/jev-latest"] },
    })

    const nine = serve({
      "/api/version": () => Response.json({ currentVersion: "0.4.1", latestVersion: null, hasUpdate: false }),
    })
    expect(await Effect.runPromise(ProviderRouter.detect({ baseURL: nine.baseURL, apiKey: "k" }))).toMatchObject({
      kind: "9router",
      version: "0.4.1",
      features: [],
    })
    // The version route is public: the key is never sent there.
    expect(nine.hits).toEqual(["/v1/capabilities Bearer k", "/v1/models/systemone Bearer k", "/api/version -"])
  })

  test("a server that answers every path with its model list is not a router", async () => {
    const list = () => Response.json({ object: "list", data: [{ id: "gpt-test" }] })
    const generic = serve({ "/v1/capabilities": list, "/v1/models/systemone": list, "/api/version": list })
    expect((await Effect.runPromise(ProviderRouter.detect({ baseURL: generic.baseURL }))).kind).toBe("none")
  })

  test("fails open on an unreachable or slow endpoint", async () => {
    const closed = serve({})
    await servers.pop()!.stop(true)
    expect((await Effect.runPromise(ProviderRouter.detect({ baseURL: closed.baseURL }))).kind).toBe("none")

    const slow = serve({
      "/v1/capabilities": () => new Promise((resolve) => setTimeout(() => resolve(Response.json(capabilities)), 2_000)),
    })
    const started = Date.now()
    const detection = await Effect.runPromise(ProviderRouter.detect({ baseURL: slow.baseURL, timeout: 100 }))
    expect(detection.kind).toBe("none")
    expect(Date.now() - started).toBeLessThan(1_500)
  })
})

describe("ProviderRouter.catalogChanged", () => {
  afterEach(() => ProviderRouter.forgetCatalogs())

  test("answers true once per new version of a connection's catalog", () => {
    const base = "http://127.0.0.1:25050/v1"
    // Nothing recorded yet: the saved models were read by an earlier process.
    expect(ProviderRouter.catalogChanged("red-router", base, "aaaa")).toBe(true)
    expect(ProviderRouter.catalogChanged("red-router", "http://localhost:25050/v1/", "aaaa")).toBe(false)
    expect(ProviderRouter.catalogChanged("red-router", base, "bbbb")).toBe(true)
    expect(ProviderRouter.catalogChanged("red-router", base, "bbbb")).toBe(false)
    // Another connection to the same address has its own key, and so its own catalog.
    expect(ProviderRouter.catalogChanged("other", base, "bbbb")).toBe(true)
    expect(ProviderRouter.catalogChanged("red-router", "not a url", "cccc")).toBe(false)
    expect(ProviderRouter.catalogChanged("red-router", base, "")).toBe(false)
  })

  test("a version recorded by discovery is not stale", () => {
    const base = "http://127.0.0.1:25050/v1"
    ProviderRouter.recordCatalog("red-router", base, "aaaa")
    expect(ProviderRouter.catalogChanged("red-router", base, "aaaa")).toBe(false)
    expect(ProviderRouter.catalogChanged("red-router", base, "bbbb")).toBe(true)
  })
})

describe("ProviderRouter headers", () => {
  const detected: Router.Detection = { kind: "red-router", features: ["decision", "token-saver"], checkedAt: 0 }

  test("asks a detected RedRouter only for what it advertised", () => {
    expect(ProviderRouter.requestHeaders(detected, { decision: false })).toEqual({ "x-red-router-decision": "off" })
    expect(ProviderRouter.requestHeaders(detected, { tokenSaver: false })).toEqual({
      "x-red-router-token-saver": "off",
    })
    expect(ProviderRouter.requestHeaders(detected, { decision: true })).toEqual({})
    expect(ProviderRouter.requestHeaders({ ...detected, features: ["decision"] }, { tokenSaver: false })).toEqual({})
    expect(ProviderRouter.requestHeaders({ ...detected, kind: "9router" }, { decision: false })).toEqual({})
    expect(ProviderRouter.requestHeaders(undefined, { tokenSaver: false })).toEqual({})
  })

  test("sends a valid hint only to a hint-accepting RedRouter serving a combo that picks per request", () => {
    const hinting: Router.Detection = { ...detected, features: ["decision", "hint"] }
    const hint = "complexity=0.5;deliberation=0.75;needs_tool=true;tier=complex"
    expect(ProviderRouter.requestHeaders(hinting, { hint, model: { strategy: "auto" } })).toEqual({
      "x-red-router-hint": hint,
    })
    expect(ProviderRouter.requestHeaders(hinting, { hint, model: { strategy: "smart" } })).toEqual({
      "x-red-router-hint": hint,
    })
    expect(ProviderRouter.requestHeaders(hinting, { hint, model: { strategy: "fallback" } })).toEqual({})
    expect(ProviderRouter.requestHeaders(hinting, { hint })).toEqual({})
    expect(ProviderRouter.requestHeaders(detected, { hint, model: { strategy: "auto" } })).toEqual({})
    expect(ProviderRouter.requestHeaders(hinting, { hint: "tier=huge", model: { strategy: "auto" } })).toEqual({})
  })

  test("sends the reasoning header only to a router that reads it, and the hint when the router decides", () => {
    const reasoning: Router.Detection = { ...detected, features: ["hint", "reasoning", "reasoning-auto"] }
    const hint = "complexity=0.5;stall=true;feedback=corrects;frustration=0.5"
    expect(ProviderRouter.requestHeaders(reasoning, { reasoning: { header: "off", hint: false } })).toEqual({
      "x-red-router-reasoning": "off",
    })
    expect(ProviderRouter.requestHeaders(detected, { reasoning: { header: "off", hint: false } })).toEqual({})
    // The router decides on a direct model: it reads the hint too, without the signal keys it does not list.
    expect(ProviderRouter.requestHeaders(reasoning, { hint, reasoning: { header: "auto", hint: true } })).toEqual({
      "x-red-router-reasoning": "auto",
      "x-red-router-hint": "complexity=0.5",
    })
    expect(
      ProviderRouter.requestHeaders(
        { ...reasoning, features: [...reasoning.features, "hint-signals"] },
        { hint, reasoning: { header: "auto", hint: true } },
      ),
    ).toEqual({ "x-red-router-reasoning": "auto", "x-red-router-hint": hint })
    // Only signal keys, to a router that does not read them: no hint at all.
    expect(
      ProviderRouter.requestHeaders(reasoning, { hint: "stall=false", reasoning: { header: "auto", hint: true } }),
    ).toEqual({ "x-red-router-reasoning": "auto" })
    expect(ProviderRouter.requestHeaders(reasoning, { hint, reasoning: { header: "off", hint: false } })).toEqual({
      "x-red-router-reasoning": "off",
    })
  })

  test("reads the reasoning level RedRouter reports applying", () => {
    expect(ProviderRouter.reported({ "X-RedRouter-Reasoning": "low->high; cause=feedback" })).toEqual({
      reasoning: { level: "high", from: "low", cause: "feedback" },
    })
    expect(ProviderRouter.reasoningReport("-->xhigh; cause=hint")).toEqual({ level: "xhigh", cause: "hint" })
    expect(ProviderRouter.reasoningReport("-->medium; cause=jev; shadow")).toEqual({
      level: "medium",
      cause: "jev",
      shadow: true,
    })
    expect(ProviderRouter.reasoningReport("medium")).toBeUndefined()
    expect(ProviderRouter.reasoningReport("low->")).toBeUndefined()
    const metadata = (value: string) => ({
      [ProviderRouter.METADATA]: ProviderRouter.reported({ "x-redrouter-reasoning": value })!,
    })
    expect(ProviderRouter.reportedReasoning(metadata("low->high; cause=stall"))).toEqual({
      level: "high",
      cause: "stall",
    })
    // A shadow decision was not applied.
    expect(ProviderRouter.reportedReasoning(metadata("-->high; cause=jev; shadow"))).toBeUndefined()
    expect(ProviderRouter.reportedReasoning(undefined)).toBeUndefined()
  })

  test("accepts only hints in RedRouter's grammar", () => {
    for (const valid of [
      "complexity=0",
      "complexity=1",
      "complexity=0.123456",
      "complexity=1.000000",
      "complexity=reasoning",
      "deliberation=0.5;needs_tool=false;tier=simple",
      "effort=xhigh;stall=false;feedback=neutral;frustration=0.25",
      "feedback=rejects",
    ])
      expect(ProviderRouter.validHint(valid)).toBe(true)
    for (const invalid of [
      "",
      "complexity=1.5",
      "complexity=0.1234567",
      "complexity=-0",
      "complexity=.5",
      "deliberation=medium",
      "needs_tool=yes",
      "tier=0.5",
      "mood=calm",
      "effort=auto",
      "stall=1",
      "feedback=angry",
      "frustration=high",
      "complexity=0.5;",
      "complexity=0.5;complexity=0.6",
      "complexity",
      "complexity=0.5=1",
      " complexity=0.5",
      `tier=simple;${"needs_tool=true;".repeat(40)}`,
    ])
      expect(ProviderRouter.validHint(invalid)).toBe(false)
    expect(ProviderRouter.hintUnit(1 / 3)).toBe("0.333333")
    expect(ProviderRouter.hintUnit(0.0000004)).toBe("0")
    expect(ProviderRouter.hintUnit(2)).toBe("1")
    expect(ProviderRouter.hintUnit(-1)).toBe("0")
  })

  test("reads the served model and its cost, trusting usage.cost only next to RedRouter's header", () => {
    expect(
      ProviderRouter.reported({ "X-RedRouter-Served-Model": "cc/claude", "X-RedRouter-Cost-USD": "0.0125" }),
    ).toEqual({ servedModel: "cc/claude", costUSD: 0.0125 })
    expect(ProviderRouter.reported({ "x-redrouter-served-model": "cc/claude" }, { cost: 0.5 })).toEqual({
      servedModel: "cc/claude",
      costUSD: 0.5,
    })
    expect(ProviderRouter.reported({}, { cost: 0.5 })).toBeUndefined()
    expect(ProviderRouter.reportedCost({ [ProviderRouter.METADATA]: { costUSD: 0 } })).toBe(0)
    expect(ProviderRouter.reportedCost({ other: { costUSD: 1 } })).toBeUndefined()
  })

  test("reads the catalog version a response reports", () => {
    const reported = ProviderRouter.reported({ "X-RedRouter-Catalog-Version": "0123456789abcdef" })
    expect(reported).toEqual({ catalogVersion: "0123456789abcdef" })
    expect(ProviderRouter.reportedCatalogVersion({ [ProviderRouter.METADATA]: reported! })).toBe("0123456789abcdef")
    expect(ProviderRouter.reportedCatalogVersion({ [ProviderRouter.METADATA]: { catalogVersion: 1 } })).toBeUndefined()
    expect(ProviderRouter.reportedCatalogVersion(undefined)).toBeUndefined()
  })

  test("compares addresses with every loopback name as one", () => {
    expect(ProviderRouter.sameEndpoint("http://localhost:25050/v1/", "http://127.0.0.1:25050/v1")).toBe(true)
    expect(ProviderRouter.sameEndpoint("http://[::1]:25050/v1", "http://127.0.0.1:25050/v1")).toBe(true)
    expect(ProviderRouter.sameEndpoint("http://127.0.0.1:25051/v1", "http://127.0.0.1:25050/v1")).toBe(false)
    expect(ProviderRouter.sameEndpoint("https://router.example/v1", "http://router.example/v1")).toBe(false)
  })
})
