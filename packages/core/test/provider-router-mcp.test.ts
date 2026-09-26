import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RouterMCP } from "../src/provider/router-mcp"

type Call = { method: string; params: Record<string, unknown>; headers: Record<string, string> }

const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  RouterMCP.forget()
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

const summary = {
  id: "anthropic/claude-sonnet-4.5",
  name: "Claude Sonnet 4.5",
  kind: "model",
  provider: { id: "anthropic", name: "Anthropic" },
  context_length: 200_000,
  max_output: 64_000,
  capabilities: ["vision", "tools", "reasoning"],
  thinking_levels: [],
  price_per_million: { input: 3, output: 15 },
  status: { state: "ok" },
  usable: true,
  free: false,
}

/** A fake of RedRouter's /v1/mcp answering with `version` in the header and initialize meta. */
function serve(input: { version?: number; meta?: boolean; header?: boolean; tools?: Record<string, unknown> }) {
  const calls: Call[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/v1/mcp") return new Response("not found", { status: 404 })
      const message = (await request.json()) as { id: number; method: string; params: Record<string, unknown> }
      calls.push({ method: message.method, params: message.params, headers: Object.fromEntries(request.headers) })
      const headers =
        input.header === false || input.version === undefined
          ? undefined
          : { [RouterMCP.VERSION_HEADER]: String(input.version) }
      if (message.method === "initialize")
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "red-router", version: "0.28.0" },
              ...(input.meta === false || input.version === undefined
                ? {}
                : { _meta: { [RouterMCP.VERSION_META]: input.version } }),
            },
          },
          { headers },
        )
      const name = String(message.params.name)
      const result = input.tools?.[name]
      if (result === undefined)
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [{ type: "text", text: "nope" }],
              structuredContent: { error: { code: "unknown_model", message: "nope" } },
              isError: true,
            },
          },
          { headers },
        )
      return Response.json(
        { jsonrpc: "2.0", id: message.id, result: { content: [], structuredContent: result } },
        { headers },
      )
    },
  })
  servers.push(server)
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, calls }
}

const recommended = {
  criteria: {},
  considered: 3,
  current: { ...summary, id: "openai/gpt-4o-mini", capabilities: ["tools"] },
  recommendations: [
    {
      ...summary,
      why: [{ code: "vision", detail: "supports vision" }],
      why_text: "supports vision",
      delta: { price_delta_pct: 20, context_delta: 72_000, gained_capabilities: ["vision"], lost_capabilities: [] },
    },
    { id: 42, broken: true },
  ],
  note: "Suggestions only",
}

describe("RouterMCP", () => {
  test("initializes with the key and schema version, then calls recommend_models with the arguments", async () => {
    const router = serve({ version: 2, tools: { recommend_models: recommended } })
    const input = { baseURL: router.baseURL, apiKey: "sk-one" }
    const result = await Effect.runPromise(
      RouterMCP.recommend(input, { needs: ["vision"], current: "openai/gpt-4o-mini", limit: 3 }),
    )
    expect(result?.current?.id).toBe("openai/gpt-4o-mini")
    // The malformed recommendation is dropped alone.
    expect(result?.recommendations.map((item) => item.id)).toEqual(["anthropic/claude-sonnet-4.5"])
    expect(result?.recommendations[0]?.delta?.gained_capabilities).toEqual(["vision"])
    expect(router.calls.map((call) => call.method)).toEqual(["initialize", "tools/call"])
    const [initialize, recommend] = router.calls
    expect(initialize?.headers.authorization).toBe("Bearer sk-one")
    expect(initialize?.headers[RouterMCP.VERSION_HEADER]).toBe("2")
    expect(record(initialize?.params._meta)[RouterMCP.VERSION_META]).toBe(2)
    expect(recommend?.headers["mcp-protocol-version"]).toBe(RouterMCP.PROTOCOL_VERSION)
    expect(recommend?.params).toEqual({
      name: "recommend_models",
      arguments: { needs: ["vision"], current: "openai/gpt-4o-mini", limit: 3 },
    })

    // The probe is reused for the same address and key.
    await Effect.runPromise(RouterMCP.recommend(input, {}))
    expect(router.calls.filter((call) => call.method === "initialize")).toHaveLength(1)
  })

  test("reads the version from initialize's meta when the header is missing", async () => {
    const router = serve({ version: 2, header: false, tools: { get_model: { id_format: "prefixed", model: summary } } })
    const input = { baseURL: router.baseURL, apiKey: "sk" }
    expect(await Effect.runPromise(RouterMCP.available(input))).toBe(true)
    expect((await Effect.runPromise(RouterMCP.model(input, summary.id)))?.name).toBe("Claude Sonnet 4.5")
  })

  test("a router with schema version 1 is off and is never asked for tools", async () => {
    const router = serve({ version: 1, tools: { recommend_models: recommended } })
    const input = { baseURL: router.baseURL, apiKey: "sk" }
    expect(await Effect.runPromise(RouterMCP.available(input))).toBe(false)
    expect(await Effect.runPromise(RouterMCP.recommend(input, {}))).toBeUndefined()
    expect(router.calls.map((call) => call.method)).toEqual(["initialize"])
  })

  test("a router that states no version is off", async () => {
    const router = serve({ tools: { recommend_models: recommended } })
    expect(await Effect.runPromise(RouterMCP.available({ baseURL: router.baseURL, apiKey: "sk" }))).toBe(false)
  })

  test("a router without /v1/mcp is off, and the absence is cached", async () => {
    const hits: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        hits.push(new URL(request.url).pathname)
        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)
    const input = { baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "sk" }
    expect(await Effect.runPromise(RouterMCP.recommend(input, {}))).toBeUndefined()
    expect(await Effect.runPromise(RouterMCP.usage(input))).toBeUndefined()
    expect(hits).toEqual(["/v1/mcp"])
  })

  test("an isError result reads as no answer", async () => {
    const router = serve({ version: 2 })
    expect(await Effect.runPromise(RouterMCP.model({ baseURL: router.baseURL, apiKey: "sk" }, "missing"))).toBeUndefined()
  })

  test("without a key the router is never asked: its MCP server always wants one", async () => {
    const router = serve({ version: 3, tools: { recommend_models: recommended } })
    expect(await Effect.runPromise(RouterMCP.available({ baseURL: router.baseURL }))).toBe(false)
    expect(await Effect.runPromise(RouterMCP.recommend({ baseURL: router.baseURL, apiKey: " " }, {}))).toBeUndefined()
    expect(router.calls).toEqual([])
  })

  test("a refused key (401) turns MCP off quietly and is not retried while cached", async () => {
    const hits: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        hits.push(request.headers.get("authorization") ?? "-")
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid API key" } },
          { status: 401, headers: { "www-authenticate": 'Bearer realm="red-router", error="invalid_token"' } },
        )
      },
    })
    servers.push(server)
    const input = { baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "sk-bad" }
    expect(await Effect.runPromise(RouterMCP.version(input))).toBeUndefined()
    expect(await Effect.runPromise(RouterMCP.available(input))).toBe(false)
    expect(await Effect.runPromise(RouterMCP.recommend(input, {}))).toBeUndefined()
    expect(hits).toEqual(["Bearer sk-bad"])
  })

  test("reads quotas from a schema 3 router and never from a schema 2 one", async () => {
    const quotas = {
      total_accounts: 1,
      providers: [
        {
          provider: "claude",
          accounts: [
            {
              connection_id: "cl1",
              account: 1,
              as_of: "2026-09-25T12:00:00Z",
              quotas: [
                {
                  name: "weekly",
                  used: 95,
                  total: 100,
                  remaining: 5,
                  remaining_pct: 5,
                  unlimited: false,
                  reset_at: "2026-09-30T00:00:00Z",
                },
              ],
            },
          ],
        },
      ],
    }
    const v3 = serve({ version: 3, tools: { get_quotas: quotas } })
    const input = { baseURL: v3.baseURL, apiKey: "sk" }
    expect(await Effect.runPromise(RouterMCP.version(input))).toBe(3)
    const read = await Effect.runPromise(RouterMCP.quotas(input, "claude"))
    expect(read?.providers[0]?.accounts[0]?.quotas[0]?.remaining_pct).toBe(5)
    expect(v3.calls.at(-1)?.params).toEqual({ name: "get_quotas", arguments: { provider: "claude" } })

    const v2 = serve({ version: 2, tools: { get_quotas: quotas } })
    expect(await Effect.runPromise(RouterMCP.quotas({ baseURL: v2.baseURL, apiKey: "sk" }, "claude"))).toBeUndefined()
    expect(v2.calls.map((call) => call.method)).toEqual(["initialize"])
  })

  test("reads the key's usage", async () => {
    const router = serve({
      version: 2,
      tools: {
        get_usage: {
          currency: "USD",
          hours: 24,
          totals: { requests: 12, errors: 1, prompt_tokens: 10, completion_tokens: 5, cost: 4.2 },
          by_model: [],
          limits: null,
          this_month: { cost: 30, tokens_today: 100 },
          remaining: null,
        },
      },
    })
    const usage = await Effect.runPromise(RouterMCP.usage({ baseURL: router.baseURL, apiKey: "sk" }, 24))
    expect(usage?.totals.cost).toBe(4.2)
    expect(usage?.this_month?.cost).toBe(30)
    expect(router.calls.at(-1)?.params).toEqual({ name: "get_usage", arguments: { hours: 24 } })
  })
})

describe("RouterMCP.usable", () => {
  const status = (state: string, usable = true) => ({ ...summary, status: { state }, usable })

  test("schema 4 trusts usable, which counts only free accounts, and never an exhausted quota", () => {
    expect(RouterMCP.usable(status("ok"), 4)).toBe(true)
    // One account is still free for this very model.
    expect(RouterMCP.usable(status("rate_limited"), 4)).toBe(true)
    expect(RouterMCP.usable(status("ok", false), 4)).toBe(false)
    for (const state of ["quota_exhausted", "unavailable", "disabled"])
      expect(RouterMCP.usable(status(state), 4)).toBe(false)
  })

  test("an older schema also drops rate limited, failing and disabled models it still calls usable", () => {
    expect(RouterMCP.usable(status("ok"), 2)).toBe(true)
    expect(RouterMCP.usable(status("unknown"), 3)).toBe(true)
    for (const state of ["rate_limited", "error", "disabled", "quota_exhausted"])
      expect(RouterMCP.usable(status(state), 3)).toBe(false)
    expect(RouterMCP.usable(status("ok", false), 2)).toBe(false)
  })

  test("reads a schema 4 status with its reset and accounts", async () => {
    const router = serve({
      version: 4,
      tools: {
        get_model: {
          model: {
            ...summary,
            status: { state: "quota_exhausted", until: "2026-09-25T18:00:00Z", accounts: { available: 0, total: 2 } },
            usable: false,
          },
        },
      },
    })
    const input = { baseURL: router.baseURL, apiKey: "sk" }
    expect(await Effect.runPromise(RouterMCP.version(input))).toBe(4)
    const model = await Effect.runPromise(RouterMCP.model(input, summary.id))
    expect(model?.status).toMatchObject({ state: "quota_exhausted", until: "2026-09-25T18:00:00Z" })
    expect(model && RouterMCP.usable(model, 4)).toBe(false)
  })
})

describe("RouterMCP.key", () => {
  function keyServer(respond: (request: Request, origin: string) => Response) {
    const seen: Array<string | null> = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        seen.push(request.headers.get("authorization"))
        return respond(request, new URL(request.url).origin)
      },
    })
    servers.push(server)
    return { baseURL: `http://127.0.0.1:${server.port}/v1`, seen }
  }

  test("reads the key's role and MCP server with the key", async () => {
    const router = keyServer((_, origin) =>
      Response.json({
        object: "api_key",
        id: "key_1",
        name: "redcode",
        role: "admin",
        id_format: "flat",
        mcp: { url: `${origin}/v1/mcp`, transport: "streamable-http", schema_version: 3, admin_tools: true },
      }),
    )
    expect(await Effect.runPromise(RouterMCP.key({ baseURL: router.baseURL, apiKey: "sk-admin" }))).toEqual({
      role: "admin",
      mcp: `${router.baseURL}/mcp`,
      version: 3,
    })
    expect(router.seen).toEqual(["Bearer sk-admin"])
  })

  test("a refused key, an older router or no key tells nothing", async () => {
    const refused = keyServer(() => Response.json({ error: {} }, { status: 401 }))
    expect(await Effect.runPromise(RouterMCP.key({ baseURL: refused.baseURL, apiKey: "sk-bad" }))).toBeUndefined()
    const older = keyServer(() => new Response("not found", { status: 404 }))
    expect(await Effect.runPromise(RouterMCP.key({ baseURL: older.baseURL, apiKey: "sk" }))).toBeUndefined()
    expect(await Effect.runPromise(RouterMCP.key({ baseURL: older.baseURL }))).toBeUndefined()
    expect(older.seen).toEqual(["Bearer sk"])
  })

  test("an MCP server on another origin is dropped, and an unknown role is none", async () => {
    const router = keyServer(() => Response.json({ role: "standard", mcp: { url: "https://elsewhere.example/v1/mcp" } }))
    expect(await Effect.runPromise(RouterMCP.key({ baseURL: router.baseURL, apiKey: "sk" }))).toEqual({
      role: "standard",
    })
    expect(RouterMCP.keyRole("owner")).toBeUndefined()
    expect(RouterMCP.mcpURL("http://127.0.0.1:25050/v1", "/v1/mcp")).toBe("http://127.0.0.1:25050/v1/mcp")
    expect(RouterMCP.mcpURL("http://127.0.0.1:25050/v1", "http://user:pw@127.0.0.1:25050/v1/mcp")).toBeUndefined()
  })
})

function record(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}
