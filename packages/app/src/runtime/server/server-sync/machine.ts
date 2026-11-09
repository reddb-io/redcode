import type { ServerConnectionStatus } from "../client"

/**
 * The stream is live only after both the transport status and the server handshake arrive. They can arrive in either
 * order, and a buffered handshake from a stream that already dropped must not start a sync.
 */
export type ConnectionSyncState =
  | { readonly type: "idle" }
  | { readonly type: "disconnected"; readonly stale: boolean; readonly handshake?: { readonly reset: boolean } }
  | { readonly type: "awaiting-handshake"; readonly stale: boolean }
  | { readonly type: "live" }
  | { readonly type: "disposed" }

export type ConnectionSyncEvent =
  | { readonly type: "status.changed"; readonly status: ServerConnectionStatus }
  | { readonly type: "handshake.received"; readonly reset: boolean }
  | { readonly type: "disposed" }

export type ConnectionSyncEffect =
  | { readonly type: "invalidate" }
  | { readonly type: "sync"; readonly restart: boolean }

export type ConnectionSyncTransition = {
  readonly state: ConnectionSyncState
  readonly effects: readonly ConnectionSyncEffect[]
}

function connectEffects(stale: boolean, reset: boolean): readonly ConnectionSyncEffect[] {
  if (!stale || !reset) return [{ type: "sync", restart: false }]
  return [{ type: "invalidate" }, { type: "sync", restart: true }]
}

export function transitionConnectionSync(
  state: ConnectionSyncState,
  event: ConnectionSyncEvent,
): ConnectionSyncTransition {
  if (state.type === "disposed") return { state, effects: [] }
  if (event.type === "disposed") return { state: { type: "disposed" }, effects: [] }

  if (event.type === "handshake.received") {
    if (state.type === "idle")
      return { state: { type: "disconnected", stale: false, handshake: { reset: event.reset } }, effects: [] }
    if (state.type === "awaiting-handshake")
      return { state: { type: "live" }, effects: connectEffects(state.stale, event.reset) }
    if (state.type === "disconnected" && !state.handshake) {
      // The transport reports connected before it publishes the handshake. A handshake observed while a stale
      // connection is already down was buffered by the previous stream and must not activate the next one.
      if (state.stale) return { state, effects: [] }
      return { state: { ...state, handshake: { reset: event.reset } }, effects: [] }
    }

    return { state, effects: [] }
  }

  if (event.status === "connected") {
    if (state.type === "idle") return { state: { type: "awaiting-handshake", stale: false }, effects: [] }
    if (state.type !== "disconnected") return { state, effects: [] }
    if (state.handshake)
      return { state: { type: "live" }, effects: connectEffects(state.stale, state.handshake.reset) }

    return { state: { type: "awaiting-handshake", stale: state.stale }, effects: [] }
  }

  if (state.type === "disconnected") return { state, effects: [] }

  return {
    state: { type: "disconnected", stale: state.type !== "idle" },
    effects: [],
  }
}
