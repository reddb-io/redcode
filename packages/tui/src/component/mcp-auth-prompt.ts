type StatusMap = Readonly<Record<string, { readonly status: string }>>

// Server name → when the user caused the transition. Short-lived, so a log out whose reconnect never
// reported needs_auth cannot swallow a real prompt much later.
const acknowledged = new Map<string, number>()
const ACKNOWLEDGE_WINDOW_MS = 30_000

/** The next `needs_auth` for `name` follows a user action (log out) and needs no prompt. */
export function acknowledge(name: string, now = Date.now()) {
  acknowledged.set(name, now)
}

function consumeAcknowledged(name: string, now: number) {
  const at = acknowledged.get(name)
  if (at === undefined) return false
  acknowledged.delete(name)
  return now - at <= ACKNOWLEDGE_WINDOW_MS
}

/**
 * Tracks MCP status snapshots and returns the servers that just entered `needs_auth`. A server is
 * reported once per transition: it has to leave `needs_auth` before it can be reported again.
 */
export function createTracker() {
  const last = new Map<string, string>()
  return (statuses: StatusMap, now = Date.now()) => {
    const entered: string[] = []
    for (const [name, item] of Object.entries(statuses)) {
      const previous = last.get(name)
      last.set(name, item.status)
      if (item.status !== "needs_auth" || previous === "needs_auth") continue
      if (consumeAcknowledged(name, now)) continue
      entered.push(name)
    }
    return entered
  }
}

export * as McpAuthPrompt from "./mcp-auth-prompt"
