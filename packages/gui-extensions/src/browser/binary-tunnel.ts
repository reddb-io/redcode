import { Browser } from "@opencode/plugin-browser/rpc"
import { StreamMux } from "@opencode/plugin-browser/stream-mux"
import { StreamWire } from "@opencode/plugin-browser/stream-wire"
import { BrowserTunnelHost } from "@opencode/plugin-browser/tunnel-host"
import { BrowserTunnelSocket } from "@opencode/plugin-browser/websocket"
import type { Session } from "@opencode/schema/session"

const RETRY_DELAY_MS = 10_000

export function createBinaryTunnel(input: {
  server: { url: string; headers: Readonly<Record<string, string>> }
  attachment: { sessionID: Session.ID; connectionID: string }
  location: { directory: string; workspace?: string }
  issue: (signal: AbortSignal) => Promise<{ ticket: string }>
  now?: () => number
}) {
  const lifetime = new AbortController()
  const now = input.now ?? Date.now
  let enabled = false
  let retryAfter = 0
  let active: StreamMux.ClientMux | undefined
  let connecting: Promise<StreamMux.ClientMux | undefined> | undefined

  const connect = async () => {
    try {
      const url = new URL(input.server.url)
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Invalid browser tunnel server URL.")
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.pathname = url.pathname.replace(/\/+$/, "") + BrowserTunnelHost.BROWSER_TUNNEL_PATH
      url.search = ""
      url.hash = ""
      url.searchParams.set("location[directory]", input.location.directory)
      if (input.location.workspace) url.searchParams.set("location[workspace]", input.location.workspace)

      const { ticket } = await input.issue(lifetime.signal)
      const headers = Object.fromEntries(
        Object.entries(input.server.headers).filter(
          ([name]) => !/^(cookie|host|connection|upgrade|origin|proxy-authorization)$|^sec-websocket-/i.test(name),
        ),
      )
      headers[BrowserTunnelHost.TICKET_HEADER] = ticket
      headers[BrowserTunnelHost.SESSION_HEADER] = input.attachment.sessionID
      headers[BrowserTunnelHost.CONNECTION_HEADER] = input.attachment.connectionID
      const socket = await BrowserTunnelSocket.open(url, headers, lifetime.signal)
      if (lifetime.signal.aborted) {
        socket.close()
        lifetime.signal.throwIfAborted()
      }
      active = StreamMux.createClientMux(socket, { streamWindowBytes: StreamWire.DEFAULT_CLIENT_STREAM_WINDOW_BYTES })
      return active
    } catch (error) {
      if (lifetime.signal.aborted) lifetime.signal.throwIfAborted()
      const missing = error instanceof Object && "type" in error && error.type === "rpc.method_not_found"
      if (!missing && !(error instanceof BrowserTunnelSocket.UpgradeError && error.fallback)) throw error
      retryAfter = now() + RETRY_DELAY_MS
      return undefined
    }
  }

  return {
    negotiate(capabilities: readonly string[] | undefined) {
      enabled = capabilities?.includes(BrowserTunnelHost.STREAM_CAPABILITY) ?? false
    },
    async open(target: Browser.TunnelTarget, signal: AbortSignal) {
      lifetime.signal.throwIfAborted()
      signal.throwIfAborted()
      if (!enabled || now() < retryAfter) return
      const mux =
        active && !active.isClosed()
          ? active
          : await (connecting ??= connect().finally(() => {
              connecting = undefined
            }))
      signal.throwIfAborted()
      // Only a failure negotiating the WebSocket permits fallback. Never retry an open or replay an active stream.
      return mux?.openStream(target, signal)
    },
    close() {
      lifetime.abort()
      active?.close()
    },
  }
}
