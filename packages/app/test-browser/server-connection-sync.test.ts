import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createConnectionSync } from "@/runtime/server/server-sync/connection"

// Runs under the browser build: the server build of Solid never runs the invalidation effect.
test("keeps cached data while disconnected and refreshes only after a reset handshake", () => {
  const calls: string[] = []

  const root = createRoot((dispose) => {
    const [status, setStatus] = createSignal<"connecting" | "connected" | "reconnecting">("connecting")

    const connection = createConnectionSync({
      status,
      invalidate: () => calls.push("invalidate"),
      connected: (info) => calls.push(`connected:${info.restart}`),
    })

    return { connection, setStatus, dispose }
  })

  try {
    expect(calls).toEqual([])
    root.connection.handleEvent({ type: "server.connected" })
    root.setStatus("connected")
    expect(calls).toEqual(["connected:false"])

    root.setStatus("reconnecting")
    // A late marker from the dead stream is ignored.
    root.connection.handleEvent({ type: "server.connected" })
    root.setStatus("connected")
    root.connection.handleEvent({ type: "server.connected" })
    expect(calls).toEqual(["connected:false", "invalidate", "connected:true"])
  } finally {
    root.dispose()
  }
})
