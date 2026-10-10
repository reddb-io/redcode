import fuzzysort from "fuzzysort"
import { IntegrationOrder } from "@opencode/util/integration-order"

type Integration = Parameters<typeof IntegrationOrder.compare>[0]

/**
 * The connect list as the TUI orders it: connected first, then popular providers (RedRouter and 9router
 * leading), then everything else. MCP servers sign in from the MCP settings instead. A search keeps that
 * order and only drops what does not match.
 */
export function connectOptions<T extends Integration>(list: readonly T[], query: string) {
  const ordered = list
    .filter((integration) => integration.metadata?.source !== "mcp")
    .toSorted(IntegrationOrder.compare)
  const needle = query.trim()

  if (!needle) return ordered
  const matched = new Set(fuzzysort.go(needle, ordered, { keys: ["name", "id"] }).map((result) => result.obj.id))

  return ordered.filter((integration) => matched.has(integration.id))
}

/** The provider a connected integration lists models under, preferring one that has models. */
export function connectedProviderID(
  providers: readonly { id: string; integrationID?: string }[],
  models: readonly { providerID: string; status?: string }[],
  integrationID: string,
) {
  const matches = providers.filter(
    (provider) => provider.integrationID === integrationID || provider.id === integrationID,
  )

  return (
    matches.find((provider) =>
      models.some((model) => model.providerID === provider.id && model.status !== "deprecated"),
    )?.id ?? matches[0]?.id
  )
}
