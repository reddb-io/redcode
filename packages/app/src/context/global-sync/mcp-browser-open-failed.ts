import type { ToastOptions } from "@reddb-io/redcode-ui/toast"

export const MCP_BROWSER_OPEN_FAILED = "mcp.browser.open.failed"

export export type McpBrowserOpenFailed = { mcpName: string; url: string }

// The server publishes this when the OAuth browser launch fails or REDCODE_NO_BROWSER blocks it.
export function readMcpBrowserOpenFailed(event: { type: string; properties?: unknown }) {
  if (event.type !== MCP_BROWSER_OPEN_FAILED) return
  const properties = event.properties
  if (!properties || typeof properties !== "object") return
  const { mcpName, url } = properties as Record<string, unknown>
  if (typeof mcpName !== "string" || typeof url !== "string" || !url) return
  // The URL comes from an MCP server and ends up in openExternal; only web authorization pages qualify.
  if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) return
  return { mcpName, url } satisfies McpBrowserOpenFailed
}

export function mcpBrowserOpenFailedToast(
  input: McpBrowserOpenFailed,
  deps: {
    openExternal: (url: string) => void
    copy: (url: string) => void
  },
): ToastOptions {
  return {
    persistent: true,
    title: `Authorize ${input.mcpName}`,
    description: `Could not open a browser. Open this URL to authorize: ${input.url}`,
    actions: [
      { label: "Open URL", onClick: () => deps.openExternal(input.url) },
      { label: "Copy URL", onClick: () => deps.copy(input.url) },
      { label: "Dismiss", onClick: "dismiss" },
    ],
  }
}
