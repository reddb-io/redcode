import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import { IntegrationOrder } from "@opencode/util/integration-order"
import {
  connectionSummary,
  connectMethods,
  credentialConnections,
  integrationOptions,
} from "../../../../src/component/dialog-integration"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [],
  connections: [],
  ...value,
})

describe("integrationOptions", () => {
  test("keeps connected services together before popular providers, including environment connections", () => {
    const sorted = integrationOptions([
      integration({ id: "red-router", name: "RedRouter" }),
      integration({ id: "openai", name: "OpenAI" }),
      integration({ id: "local", name: "Local", connections: [{ type: "env", name: "LOCAL_KEY" }] }),
      integration({
        id: "mistral",
        name: "Mistral",
        connections: [
          { type: "credential", id: "cred_one", label: "Work", method: "key" },
          { type: "credential", id: "cred_two", label: "Personal", method: "key" },
        ],
      }),
      integration({
        id: "github",
        name: "GitHub",
        metadata: { source: "mcp" },
        connections: [{ type: "credential", id: "cred_github", label: "GitHub", method: "oauth" }],
      }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(["github", "local", "mistral", "red-router", "openai"])
    expect(sorted.map(IntegrationOrder.category)).toEqual(["Connected", "Connected", "Connected", "Popular", "Popular"])
  })

  test("keeps popular integrations first and sorts the rest alphabetically", () => {
    expect(
      integrationOptions([
        integration({ id: "mistral", name: "Mistral" }),
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "custom-z", name: "Zebra" }),
        integration({ id: "anthropic", name: "Anthropic" }),
        integration({ id: "red-router", name: "RedRouter" }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["red-router", "opencode-go", "opencode", "openai", "anthropic", "mistral", "custom-z"])
  })

  test("lists the OpenAI-compatible wizard with the popular providers", () => {
    expect(
      integrationOptions([
        integration({ id: "mistral", name: "Mistral" }),
        integration({ id: "openai-compatible", name: "OpenAI-compatible endpoint" }),
        integration({ id: "google", name: "Google" }),
        integration({ id: "red-router", name: "RedRouter" }),
      ]).map((item) => item.id),
    ).toEqual(["red-router", "google", "openai-compatible", "mistral"])
  })

  test("lists popular providers before disconnected MCP integrations", () => {
    expect(
      integrationOptions([
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "linear", name: "Linear", metadata: { source: "mcp" } }),
        integration({ id: "github", name: "GitHub", metadata: { source: "mcp" } }),
        integration({ id: "red-router", name: "RedRouter" }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["red-router", "opencode-go", "opencode", "openai", "github", "linear"])
  })
})

test("S1 shows active connections before an inactive configured evaluator without changing its identity", () => {
  const options = [
    {
      name: "Personal",
      configured: true,
      evaluator: { transport: "red-router", baseURL: "https://personal/v1", credentialID: "cred_personal" },
    },
    {
      name: "Work",
      configured: false,
      evaluator: { transport: "red-router", baseURL: "https://work/v1", credentialID: "cred_work" },
    },
    { name: "Env", configured: false, evaluator: { transport: "openai", baseURL: "https://api.openai.com/v1" } },
  ]
  expect(
    IntegrationOrder.evaluators(options, [
      integration({
        id: "red-router",
        name: "RedRouter",
        connections: [
          { type: "credential", id: "cred_work", label: "Work", method: "key" },
          { type: "credential", id: "cred_personal", label: "Personal", method: "key" },
        ],
      }),
    ]),
  ).toEqual([options[1], options[2], options[0]])
  expect(options[0].evaluator.credentialID).toBe("cred_personal")
})

describe("connectMethods", () => {
  test("offers key and OAuth methods but not environment discovery", () => {
    expect(
      connectMethods(
        integration({
          id: "example",
          name: "Example",
          methods: [
            { type: "env", names: ["EXAMPLE_KEY"] },
            { type: "key", label: "API key" },
            { type: "oauth", id: "account", label: "Account" },
          ],
        }),
      ).map((method) => method.type),
    ).toEqual(["oauth", "key"])
  })
})

describe("credentialConnections", () => {
  test("returns removable credential connections only", () => {
    expect(
      credentialConnections(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "env", name: "EXAMPLE_KEY" },
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
          ],
        }),
      ),
    ).toEqual([{ type: "credential", method: "key", id: "cred_1", label: "Work" }])
  })
})

describe("connectionSummary", () => {
  test("shows credential labels and environment variables", () => {
    expect(
      connectionSummary(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
            { type: "env", name: "EXAMPLE_KEY" },
          ],
        }),
      ),
    ).toBe("Work, $EXAMPLE_KEY")
  })
})
