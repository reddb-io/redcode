import type { ToastOptions } from "@reddb-io/redcode-ui/toast"

export const MCP_BROWSER_OPEN_FAILED = "mcp.browser.open.failed"

export type McpBrowserOpenFailedKey =
  | "mcp.auth.browserBlocked.title"
  | "mcp.auth.browserBlocked.description"
  | "mcp.auth.browserBlocked.open"
  | "mcp.auth.browserBlocked.copy"
  | "common.dismiss"

export type McpBrowserOpenFailed = { mcpName: string; url: string }

// The server publishes this when the OAuth browser launch fails or REDCODE_NO_BROWSER blocks it.
export function readMcpBrowserOpenFailed(event: { type: string; properties?: unknown }) {
  if (event.type !== MCP_BROWSER_OPEN_FAILED) return
  const properties = event.properties
  if (!properties || typeof properties !== "object") return
  const { mcpName, url } = properties as Record<string, unknown>
  if (typeof mcpName !== "string" || typeof url !== "string" || !url) return
  return { mcpName, url } satisfies McpBrowserOpenFailed
}

export function mcpBrowserOpenFailedToast(
  input: McpBrowserOpenFailed,
  deps: {
    t: (key: McpBrowserOpenFailedKey, params?: Record<string, string>) => string
    openExternal: (url: string) => void
    copy: (url: string) => void
  },
): ToastOptions {
  return {
    persistent: true,
    title: deps.t("mcp.auth.browserBlocked.title", { name: input.mcpName }),
    description: deps.t("mcp.auth.browserBlocked.description", { url: input.url }),
    actions: [
      { label: deps.t("mcp.auth.browserBlocked.open"), onClick: () => deps.openExternal(input.url) },
      { label: deps.t("mcp.auth.browserBlocked.copy"), onClick: () => deps.copy(input.url) },
      { label: deps.t("common.dismiss"), onClick: "dismiss" },
    ],
  }
}
