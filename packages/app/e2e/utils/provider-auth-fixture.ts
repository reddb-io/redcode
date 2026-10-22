import type { Page } from "@playwright/test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { NO_PROVIDER } from "./app"
import { openSettings } from "./workspace"

/** Deterministic credentials and attempts; no real sign-in or command process starts. */
export async function openProviderAuthentication(page: Page) {
  const state = { connected: false, keyRequests: 0, codeRequests: 0, mode: "code" as "code" | "auto" }
  const keys: unknown[] = []
  const codes: unknown[] = []
  const cancellations: string[] = []
  const attempts: string[] = []
  const integrations: IntegrationInfo[] = [
    {
      id: "red-router",
      name: "RedRouter",
      metadata: {},
      connections: [],
      methods: [
        {
          type: "key",
          form: [
            { type: "string", key: "hidden", default: "retained", hidden: true },
            { type: "boolean", key: "custom", title: "Use a custom endpoint?", default: false },
            {
              type: "string",
              key: "region",
              title: "Region",
              default: "east",
              options: [
                { value: "east", label: "East" },
                { value: "west", label: "West" },
              ],
              custom: true,
            },
            {
              type: "integer",
              key: "port",
              title: "Port",
              required: true,
              when: [{ key: "custom", op: "eq", value: true }],
            },
            {
              type: "string",
              key: "inactive",
              title: "Inactive field",
              when: [{ key: "custom", op: "eq", value: false }],
            },
          ],
        },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      metadata: {},
      connections: [],
      methods: [
        { type: "oauth", id: "browser", label: "Browser login (browser)" },
        { type: "command", id: "cli", label: "CLI login", command: ["fixture-provider", "login"] },
        { type: "key" },
      ],
    },
    {
      id: "environment",
      name: "Environment only",
      metadata: {},
      connections: [],
      methods: [{ type: "env", names: ["FIXTURE"] }],
    },
    {
      id: "fixture-mcp",
      name: "MCP fixture",
      metadata: { source: "mcp" },
      connections: [],
      methods: [{ type: "key" }],
    },
    {
      id: "opencode",
      name: "OpenCode Console",
      metadata: {},
      connections: [],
      methods: [{ type: "oauth", id: "device", label: "Console account" }, { type: "key" }],
    },
  ]
  const catalog = {
    all: [
      {
        id: "red-router",
        name: "RedRouter",
        models: {
          first: { id: "first", name: "Fixture First", cost: { input: 1, output: 1 } },
          second: { id: "second", name: "Fixture Second", cost: { input: 1, output: 1 } },
        },
      },
    ],
    connected: ["red-router"],
    default: {},
  }
  const workspace = await openSettings(page, {
    name: "Provider authentication",
    sessions: [],
    integrations,
    provider: () => (state.connected ? catalog : NO_PROVIDER),
    seed: { tabs: [] },
  })
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  }
  await page.route(
    (url) => /^\/api\/integration\/[^/]+\/connect\//.test(url.pathname),
    async (route) => {
      const request = route.request()
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
      const url = new URL(request.url())
      const parts = url.pathname.split("/")
      const kind = parts[5]
      const attemptID = parts[6]
      const location = { directory: url.searchParams.get("directory") ?? workspace.directory }
      const time = { created: 1, expires: Date.now() + 600_000 }
      if (request.method() === "DELETE") {
        cancellations.push(`${kind}:${attemptID}`)
        return route.fulfill({ status: 204, headers })
      }
      if (kind === "key") {
        keys.push(request.postDataJSON())
        state.keyRequests++
        if (state.keyRequests === 1)
          return route.fulfill({ status: 400, json: { message: "Fixture key rejected" }, headers })
        state.connected = true
        return route.fulfill({ status: 204, headers })
      }
      if (parts[7] === "complete") {
        codes.push(request.postDataJSON())
        state.codeRequests++
        return state.codeRequests === 1
          ? route.fulfill({ status: 400, json: { message: "Fixture code rejected" }, headers })
          : route.fulfill({ status: 204, headers })
      }
      if (request.method() === "POST") {
        attempts.push(kind)
        return route.fulfill({
          json: {
            location,
            data: {
              attemptID: `con_fixture_${kind}`,
              time,
              ...(kind === "oauth"
                ? { url: "https://auth.example.test/device?user_code=ABCD-EFGH", instructions: "", mode: state.mode }
                : {}),
            },
          },
          headers,
        })
      }
      return route.fulfill({
        json: {
          location,
          data: {
            status: "pending",
            time,
            ...(kind === "command" ? { message: "Fixture CLI waiting for authorization" } : {}),
          },
        },
        headers,
      })
    },
  )
  return { ...workspace, state, keys, codes, cancellations, attempts }
}
