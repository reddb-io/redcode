type StatusMap = Readonly<Record<string, { readonly status: string }>>

// Workspace and server → when the user caused the transition (log out). Short-lived, so a log out whose
// reconnect never reported needs_auth cannot swallow a real prompt much later.
const acknowledged = new Map<string, number>()
const ACKNOWLEDGE_WINDOW_MS = 30_000

const scoped = (workspace: string | undefined, name: string) => JSON.stringify([workspace ?? null, name])

/** The next `needs_auth` for `name` in `workspace` follows a user action and needs no prompt. */
export function acknowledge(workspace: string | undefined, name: string, now = Date.now()) {
  acknowledged.set(scoped(workspace, name), now)
}

function consumeAcknowledged(key: string, now: number) {
  const at = acknowledged.get(key)
  if (at === undefined) return false
  acknowledged.delete(key)
  return now - at <= ACKNOWLEDGE_WINDOW_MS
}

/**
 * Tracks MCP status snapshots and returns the servers that just entered `needs_auth`. A server is
 * reported once per transition: it has to reach another status before it can be reported again.
 * `disabled` does not count as leaving, so toggling a server off and on does not prompt twice.
 */
export function createTracker() {
  const last = new Map<string, string>()
  return (statuses: StatusMap, workspace?: string, now = Date.now()) => {
    const entered: string[] = []
    for (const [name, item] of Object.entries(statuses)) {
      const key = scoped(workspace, name)
      if (item.status === "disabled") continue
      const previous = last.get(key)
      last.set(key, item.status)
      if (item.status !== "needs_auth") continue
      // Any needs_auth snapshot settles a pending acknowledgement, including one that was already needs_auth.
      const acknowledgedNow = consumeAcknowledged(key, now)
      if (previous === "needs_auth" || acknowledgedNow) continue
      entered.push(name)
    }
    return entered
  }
}

export * as McpAuthPrompt from "./mcp-auth-prompt"
