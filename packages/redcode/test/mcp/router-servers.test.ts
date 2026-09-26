import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import type { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { Router } from "@reddb-io/redcode-schema/router"
import { Effect } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { MCP } from "../../src/mcp/index"
import { McpRouterServers } from "../../src/mcp/router-servers"
import { testEffect } from "../lib/effect"

describe("McpRouterServers.servers", () => {
  const redRouter = (router: Record<string, unknown>, options: Record<string, unknown> = { apiKey: "sk-config" }) => ({
    name: "RedRouter",
    options: { baseURL: "http://127.0.0.1:25050/v1", ...options },
    router,
  })

  test("registers each RedRouter that reported an MCP server, with the connection's key as bearer", () => {
    expect(
      McpRouterServers.servers({
        providers: {
          "red-router": redRouter({ kind: "red-router", role: "admin", mcp: "http://127.0.0.1:25050/v1/mcp" }),
          office: redRouter({ kind: "red-router", role: "standard", mcp: "http://office:25050/v1/mcp" }, {}),
        },
        keyOf: (providerID) => (providerID === "office" ? "sk-stored" : undefined),
      }),
    ).toEqual({
      "red-router": {
        type: "remote",
        url: "http://127.0.0.1:25050/v1/mcp",
        headers: { Authorization: "Bearer sk-config" },
        oauth: false,
      },
      office: {
        type: "remote",
        url: "http://office:25050/v1/mcp",
        headers: { Authorization: "Bearer sk-stored" },
        oauth: false,
      },
    })
  })

  test("none for a disabled provider, one without a key or MCP server, or another router", () => {
    expect(
      McpRouterServers.servers({
        providers: {
          disabled: redRouter({ kind: "red-router", mcp: "http://a/v1/mcp" }),
          keyless: redRouter({ kind: "red-router", mcp: "http://b/v1/mcp" }, {}),
          older: redRouter({ kind: "red-router" }),
          nine: redRouter({ kind: "9router", mcp: "http://c/v1/mcp" }),
          direct: { options: { apiKey: "sk" } },
        },
        disabled: ["disabled"],
        keyOf: () => undefined,
      }),
    ).toEqual({})
  })
})

// A RedRouter MCP server: it names itself `red-router`, lists key-management tools and records every
// request's authorization and method.
const router = {
  close: async () => {},
  url: "",
  requests: [] as Array<{ authorization: string | null; method: string | undefined }>,
}

beforeAll(() => {
  const http = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = request.method === "POST" ? await request.clone().json().catch(() => undefined) : undefined
      router.requests.push({
        authorization: request.headers.get("authorization"),
        method: typeof body?.method === "string" ? body.method : undefined,
      })
      // Stateless, like RedRouter's: a fresh server answers each request, so any request may initialize.
      const protocol = new Server({ name: "red-router", version: "0.29.0" }, { capabilities: { tools: {} } })
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({
          tools: ["list_models", "create_api_key"].map((name) => ({
            name,
            inputSchema: { type: "object" as const, properties: {} },
          })),
        }),
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      return transport.handleRequest(request)
    },
  })
  router.url = new URL("/v1/mcp", http.url).toString()
  router.close = () => http.stop(true)
})

afterAll(() => router.close())

const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, EventV2Bridge.node])))

const connected = (extra: Partial<ConfigV1.Info> = {}) => (): Partial<ConfigV1.Info> => ({
  provider: {
    "red-router": {
      name: "RedRouter",
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "sk-admin", baseURL: new URL("/v1", router.url).toString() },
      router: { kind: "red-router" as const, role: "admin" as const, mcp: router.url },
      models: {},
    },
  },
  ...extra,
})

const initializes = () => router.requests.filter((request) => request.method === "initialize").length

describe("RedRouter MCP registration", () => {
  it.instance(
    "a connected RedRouter's MCP server is registered with its key and lists its tools",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        expect((yield* mcp.status())["red-router"]).toMatchObject({ status: "connected" })
        expect(Object.keys(yield* mcp.tools())).toEqual(
          expect.arrayContaining(["red-router_list_models", "red-router_create_api_key"]),
        )
        expect(router.requests.every((request) => request.authorization === "Bearer sk-admin")).toBe(true)
      }),
    { config: connected() },
  )

  it.instance(
    "a catalog refresh of that RedRouter reconnects its server, listing its tools again",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const events = yield* EventV2Bridge.Service
        expect((yield* mcp.status())["red-router"]).toMatchObject({ status: "connected" })
        const before = initializes()
        yield* events.publish(Router.Event.CatalogUpdated, {
          providerID: "red-router",
          name: "RedRouter",
          added: 0,
          removed: 0,
          renamed: 0,
        })
        const deadline = Date.now() + 3_000
        while (initializes() === before && Date.now() < deadline) yield* Effect.sleep("20 millis")
        expect(initializes()).toBeGreaterThan(before)
      }),
    { config: connected() },
  )

  it.instance(
    "an MCP server the configuration declares under the same name wins",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        const status = yield* mcp.status()
        // The declared entry, disabled, replaces the derived one.
        expect(status["red-router"]).toMatchObject({ status: "disabled" })
      }),
    { config: connected({ mcp: { "red-router": { type: "remote", url: "http://127.0.0.1:9/mcp", enabled: false } } }) },
  )

  it.instance(
    "a removed RedRouter provider leaves no MCP server behind",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        expect((yield* mcp.status())["red-router"]).toBeUndefined()
      }),
    { config: () => ({ provider: {} }) },
  )
})
