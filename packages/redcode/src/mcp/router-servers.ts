import type { ConfigMCPV1 } from "@reddb-io/redcode-core/v1/config/mcp"
import { isRecord } from "@/util/record"

/**
 * The MCP servers of connected RedRouters: every RedRouter provider connection whose router reported
 * an MCP server (`router.mcp`) gets a remote server named after the provider (`red-router` for the
 * default connection), reached with the connection's own key. A provider that is disabled, or has no
 * key, gets none. An MCP server the configuration declares under the same name wins over it.
 */
export function servers(input: {
  readonly providers: Readonly<Record<string, unknown>> | undefined
  readonly disabled?: ReadonlyArray<string>
  readonly keyOf: (providerID: string) => string | undefined
}): Record<string, ConfigMCPV1.Remote> {
  return Object.fromEntries(
    Object.entries(input.providers ?? {}).flatMap(([providerID, entry]) => {
      if (!isRecord(entry) || input.disabled?.includes(providerID)) return []
      const router = isRecord(entry.router) ? entry.router : undefined
      if (router?.kind !== "red-router" || typeof router.mcp !== "string") return []
      const options = isRecord(entry.options) ? entry.options : {}
      const key = input.keyOf(providerID) ?? (typeof options.apiKey === "string" ? options.apiKey : undefined)
      if (!key) return []
      const server: ConfigMCPV1.Remote = {
        type: "remote",
        url: router.mcp,
        headers: { Authorization: `Bearer ${key}` },
        // The key is the credential; RedRouter's MCP server never asks for OAuth.
        oauth: false,
      }
      return [[providerID, server] as const]
    }),
  )
}

export * as McpRouterServers from "./router-servers"
