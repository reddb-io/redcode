import { createEffect, onCleanup, untrack, type Accessor } from "solid-js"
import type { ServerConnectionStatus } from "../client"
import { transitionConnectionSync, type ConnectionSyncEvent, type ConnectionSyncState } from "./machine"

export function createConnectionSync(input: {
  status: Accessor<ServerConnectionStatus>
  invalidate: () => void
  connected: (info: { restart: boolean }) => void
}) {
  let connection: ConnectionSyncState = { type: "idle" }

  function dispatch(event: ConnectionSyncEvent) {
    const result = transitionConnectionSync(connection, event)
    connection = result.state
    result.effects.forEach((effect) => {
      if (effect.type === "invalidate") return input.invalidate()
      input.connected({ restart: effect.restart })
    })
  }

  createEffect(() => {
    const status = input.status()
    untrack(() => dispatch({ type: "status.changed", status }))
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  function handleEvent(event: { type: string; data?: unknown }) {
    if (event.type !== "server.connected") return
    // Servers predating resumable streams omit metadata and keep the conservative full-refresh behavior.
    dispatch({ type: "handshake.received", reset: streamReset(event.data) })
  }

  return { handleEvent }
}

function streamReset(data: unknown) {
  if (typeof data !== "object" || data === null || !("stream" in data)) return true
  const stream = data.stream
  if (typeof stream !== "object" || stream === null || !("reset" in stream)) return true
  return stream.reset === true
}

// Directories a mounted view holds refresh first; the rest keep their existing order behind them.
export function reconnectOrder(directories: string[], held: (directory: string) => boolean) {
  return [...directories.filter(held), ...directories.filter((directory) => !held(directory))]
}
