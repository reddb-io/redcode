export * as IntegrationOrder from "./integration-order.js"

const priority = new Map([
  ["red-router", 0],
  ["9router", 1],
  ["opencode-go", 2],
  ["opencode", 3],
  ["openai", 4],
  ["github-copilot", 5],
  ["anthropic", 6],
  ["google", 7],
  ["openai-compatible", 8],
])

type Integration = {
  id: string
  name: string
  metadata?: Record<string, unknown>
  connections: readonly ({ type: "credential"; id: string } | { type: "env"; name: string })[]
}

/** Where a provider or integration id sits among the popular ones; anything else ranks after them. */
export function providerRank(id: string) {
  return priority.get(id) ?? 99
}

export function category(integration: Integration) {
  if (integration.connections.length) return "Connected"
  if (priority.has(integration.id)) return "Popular"
  if (integration.metadata?.source === "mcp") return "MCP"
  return "Services"
}

/** Keep sections contiguous: grouped pickers must preserve the same order as flat pickers. */
export function compare(a: Integration, b: Integration) {
  const rank = { Connected: 0, Popular: 1, MCP: 2, Services: 3 }
  return (
    rank[category(a)] - rank[category(b)] ||
    providerRank(a.id) - providerRank(b.id) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  )
}

export function evaluators<
  T extends {
    name: string
    configured: boolean
    evaluator: { transport: string; baseURL: string; credentialID?: string }
  },
>(options: readonly T[], integrations: readonly Integration[]) {
  const active = new Set(
    integrations.flatMap((integration) => {
      const connection = integration.connections[0]
      return connection?.type === "credential" ? [connection.id] : []
    }),
  )
  const rank = (option: T) => Number(!option.evaluator.credentialID || active.has(option.evaluator.credentialID))
  return options.toSorted(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(b.configured) - Number(a.configured) ||
      (priority.get(a.evaluator.transport) ?? 99) - (priority.get(b.evaluator.transport) ?? 99) ||
      a.name.localeCompare(b.name) ||
      a.evaluator.baseURL.localeCompare(b.evaluator.baseURL) ||
      (a.evaluator.credentialID ?? "").localeCompare(b.evaluator.credentialID ?? ""),
  )
}
