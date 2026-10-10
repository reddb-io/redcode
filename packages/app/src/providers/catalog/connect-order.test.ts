import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { connectedProviderID, connectOptions } from "./connect-order"

const integration = (id: string, name: string, extra: Partial<IntegrationInfo> = {}): IntegrationInfo => ({
  id,
  name,
  methods: [],
  connections: [],
  ...extra,
})

const catalog = [
  integration("mistral", "Mistral"),
  integration("openai", "OpenAI"),
  integration("ollama", "Ollama"),
  integration("openai-compatible", "OpenAI-compatible endpoint"),
  integration("9router", "9router"),
  integration("red-router", "RedRouter"),
  integration("github", "GitHub", { metadata: { source: "mcp" } }),
  integration("anthropic", "Anthropic", {
    connections: [
      { type: "credential", id: "cred_work", label: "Work", method: "key" },
      { type: "credential", id: "cred_home", label: "Home", method: "key" },
    ],
  }),
  integration("groq", "Groq", { connections: [{ type: "env", name: "GROQ_API_KEY" }] }),
]

describe("connectOptions", () => {
  test("lists connected integrations first, then RedRouter, 9router and the other popular ones, then the rest", () => {
    expect(connectOptions(catalog, "").map((item) => item.id)).toEqual([
      "anthropic",
      "groq",
      "red-router",
      "9router",
      "openai",
      "openai-compatible",
      "mistral",
      "ollama",
    ])
  })

  test("keeps MCP servers out: they sign in from the MCP settings", () => {
    expect(connectOptions(catalog, "").some((item) => item.id === "github")).toBe(false)
  })

  test("a search keeps the list order and finds local servers and the OpenAI-compatible endpoint", () => {
    expect(connectOptions(catalog, "ollama").map((item) => item.id)).toEqual(["ollama"])
    expect(connectOptions(catalog, "compatible").map((item) => item.id)).toEqual(["openai-compatible"])
    expect(connectOptions(catalog, "openai").map((item) => item.id)).toEqual(["openai", "openai-compatible"])
  })
})

describe("connectedProviderID", () => {
  test("prefers the integration's provider that lists models", () => {
    expect(
      connectedProviderID(
        [
          { id: "opencode", integrationID: "opencode" },
          { id: "console-openai", integrationID: "opencode" },
        ],
        [{ providerID: "console-openai" }, { providerID: "opencode", status: "deprecated" }],
        "opencode",
      ),
    ).toBe("console-openai")
  })

  test("falls back to the first matching provider, or none", () => {
    expect(connectedProviderID([{ id: "my-endpoint", integrationID: "my-endpoint" }], [], "my-endpoint")).toBe(
      "my-endpoint",
    )
    expect(connectedProviderID([], [], "missing")).toBeUndefined()
  })
})
