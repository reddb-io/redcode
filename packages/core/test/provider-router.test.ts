import { describe, expect, test } from "bun:test"
import { ProviderRouter } from "@opencode/core/provider-router"
import type { Router } from "@opencode/schema/router"

const features = (...items: Router.Feature[]) => new Set<Router.Feature>(items)

describe("ProviderRouter.requestHeaders", () => {
  test("leaves the effort to the router's autopilot for the auto variant and sends it the hint", () => {
    expect(
      ProviderRouter.requestHeaders({
        features: features("reasoning", "reasoning-auto", "hint"),
        variant: "auto",
        guidance: { hint: "complexity=0.5;needs_tool=true" },
      }),
    ).toEqual({ "x-red-router-reasoning": "auto", "x-red-router-hint": "complexity=0.5;needs_tool=true" })
  })

  test("never lets the router override a person's own variant", () => {
    expect(
      ProviderRouter.requestHeaders({
        features: features("reasoning", "reasoning-auto", "hint"),
        variant: "high",
        guidance: { hint: "complexity=0.5" },
      }),
    ).toEqual({ "x-red-router-reasoning": "off" })
  })

  test("hints a combo that picks its member per request", () => {
    expect(
      ProviderRouter.requestHeaders({
        features: features("hint"),
        strategy: "smart",
        guidance: { hint: "tier=complex" },
      }),
    ).toEqual({ "x-red-router-hint": "tier=complex" })
  })

  test("sends nothing the router did not advertise", () => {
    expect(
      ProviderRouter.requestHeaders({
        features: features(),
        variant: "auto",
        strategy: "auto",
        tokenSaver: false,
        guidance: { hint: "tier=complex", decision: false },
      }),
    ).toEqual({})
  })

  test("turns the token saver and the decision layer off when asked", () => {
    expect(
      ProviderRouter.requestHeaders({
        features: features("token-saver", "decision"),
        tokenSaver: false,
        guidance: { decision: false },
      }),
    ).toEqual({ "x-red-router-token-saver": "off", "x-red-router-decision": "off" })
  })

  test("drops reasoning signals a router without hint signals would reject, and invalid hints", () => {
    const input = { features: features("hint"), strategy: "auto" }
    expect(
      ProviderRouter.requestHeaders({ ...input, guidance: { hint: "complexity=0.4;stall=true;frustration=0.9" } }),
    ).toEqual({ "x-red-router-hint": "complexity=0.4" })
    expect(ProviderRouter.requestHeaders({ ...input, guidance: { hint: "complexity=2" } })).toEqual({})
    expect(ProviderRouter.requestHeaders({ ...input, guidance: { hint: "tier=simple;tier=complex" } })).toEqual({})
  })
})

describe("ProviderRouter hints", () => {
  test("validates the hint grammar", () => {
    expect(ProviderRouter.validHint("complexity=reasoning;deliberation=0.25;effort=high;feedback=agrees")).toBe(true)
    expect(ProviderRouter.validHint("unknown=1")).toBe(false)
    expect(ProviderRouter.validHint(`complexity=${"0".repeat(600)}`)).toBe(false)
    expect(ProviderRouter.hintUnit(1.7)).toBe("1")
    expect(ProviderRouter.hintUnit(0.1234567)).toBe("0.123457")
  })

  test("keeps the latest guidance per Session until it is forgotten", () => {
    ProviderRouter.guide("ses_guided", { hint: "tier=simple" })
    expect(ProviderRouter.guidance("ses_guided")).toEqual({ hint: "tier=simple" })
    ProviderRouter.guide("ses_guided", undefined)
    expect(ProviderRouter.guidance("ses_guided")).toBeUndefined()
  })
})

describe("ProviderRouter reports", () => {
  test("reads the served model, cost, catalog version and applied reasoning from response headers", () => {
    expect(
      ProviderRouter.reported(
        new Headers({
          "X-RedRouter-Served-Model": "anthropic/claude-sonnet-4-6",
          "X-RedRouter-Cost-USD": "0.0125",
          "X-RedRouter-Catalog-Version": "v42",
          "X-RedRouter-Reasoning": "low->high; cause=frustration",
        }),
      ),
    ).toEqual({
      servedModel: "anthropic/claude-sonnet-4-6",
      costUSD: 0.0125,
      catalogVersion: "v42",
      reasoning: { level: "high", from: "low", cause: "frustration" },
    })
    expect(ProviderRouter.reported(new Headers({ "content-type": "application/json" }))).toBeUndefined()
    expect(ProviderRouter.reported(new Headers({ "x-redrouter-cost-usd": "-1" }))).toBeUndefined()
  })

  test("reads a shadow reasoning report without a previous level", () => {
    expect(ProviderRouter.reasoningReport("-->medium; cause=auto; shadow")).toEqual({
      level: "medium",
      cause: "auto",
      shadow: true,
    })
    expect(ProviderRouter.reasoningReport("high")).toBeUndefined()
  })

  test("merges what a step's responses report and hands it over once", () => {
    ProviderRouter.observe("ses_report", { servedModel: "openai/gpt-6-luna" })
    ProviderRouter.observe("ses_report", { costUSD: 0.5 })
    expect(ProviderRouter.take("ses_report")).toEqual({ servedModel: "openai/gpt-6-luna", costUSD: 0.5 })
    expect(ProviderRouter.take("ses_report")).toBeUndefined()
  })

  test("reads a stream's usage cost without changing the stream", async () => {
    const found: number[] = []
    const text = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,',
      '"cost":0.002}}\n\ndata: [DONE]\n\n',
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        text.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
        controller.close()
      },
    }).pipeThrough(ProviderRouter.usageCost((cost) => found.push(cost)))
    expect(await new Response(body).text()).toBe(text.join(""))
    expect(found).toEqual([0.002])
  })
})

describe("ProviderRouter keys", () => {
  test("reads a key role and keeps the MCP server only on the router's own origin", () => {
    expect(ProviderRouter.keyRole("admin")).toBe("admin")
    expect(ProviderRouter.keyRole("owner")).toBeUndefined()
    expect(ProviderRouter.mcpURL("https://router.example/v1", "/v1/mcp")).toBe("https://router.example/v1/mcp")
    expect(ProviderRouter.mcpURL("https://router.example/v1", "https://router.example/mcp")).toBe(
      "https://router.example/mcp",
    )
    expect(ProviderRouter.mcpURL("https://router.example/v1", "https://elsewhere.example/mcp")).toBeUndefined()
    expect(ProviderRouter.mcpURL("https://router.example/v1", "")).toBeUndefined()
  })

  test("protects RedRouter key management and nothing else", () => {
    expect(ProviderRouter.protectedCall({ server: "red-router", tool: "create_api_key", args: {} })).toBeDefined()
    expect(ProviderRouter.protectedCall({ server: "red-router", tool: "list_api_keys", args: {} })).toBeDefined()
    expect(
      ProviderRouter.protectedCall({ server: "red-router", tool: "get_usage", args: { api_key_id: "key_1" } }),
    ).toBeDefined()
    expect(ProviderRouter.protectedCall({ server: "red-router", tool: "get_usage", args: {} })).toBeUndefined()
    expect(ProviderRouter.protectedCall({ server: "red-router", tool: "list_models", args: {} })).toBeUndefined()
    expect(ProviderRouter.protectedCall({ server: "billing", tool: "create_api_key", args: {} })).toBeUndefined()
  })
})
