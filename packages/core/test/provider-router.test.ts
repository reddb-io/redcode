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

describe("ProviderRouter headers", () => {
  const detected: Router.Detection = { kind: "red-router", features: ["decision", "token-saver"], checkedAt: 0 }

  test("asks a detected RedRouter only for what it advertised", () => {
    expect(ProviderRouter.requestHeaders(detected, { decision: false })).toEqual({ "x-red-router-decision": "off" })
    expect(ProviderRouter.requestHeaders(detected, { tokenSaver: false })).toEqual({ "x-red-router-token-saver": "off" })
    expect(ProviderRouter.requestHeaders(detected, { decision: true })).toEqual({})
    expect(ProviderRouter.requestHeaders({ ...detected, features: ["decision"] }, { tokenSaver: false })).toEqual({})
    expect(ProviderRouter.requestHeaders({ ...detected, kind: "9router" }, { decision: false })).toEqual({})
    expect(ProviderRouter.requestHeaders(undefined, { tokenSaver: false })).toEqual({})
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

  test("compares addresses with every loopback name as one", () => {
    expect(ProviderRouter.sameEndpoint("http://localhost:25050/v1/", "http://127.0.0.1:25050/v1")).toBe(true)
    expect(ProviderRouter.sameEndpoint("http://[::1]:25050/v1", "http://127.0.0.1:25050/v1")).toBe(true)
    expect(ProviderRouter.sameEndpoint("http://127.0.0.1:25051/v1", "http://127.0.0.1:25050/v1")).toBe(false)
    expect(ProviderRouter.sameEndpoint("https://router.example/v1", "http://router.example/v1")).toBe(false)
  })
})
