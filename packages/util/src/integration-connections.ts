export * as IntegrationConnections from "./integration-connections.js"

/** How clients list an integration's connect methods and saved connections; shared by the TUI and the desktop app. */

type Connection = { type: "credential"; id: string; label: string } | { type: "env"; name: string }

/** The methods a person can start, keys last; environment discovery is not one. */
export function connectMethods<M extends { type: string }>(integration: { methods: ReadonlyArray<M> }) {
  return integration.methods
    .filter((method): method is Exclude<M, { type: "env" }> => method.type !== "env")
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

/** Saved credentials, the active one first. */
export function credentialConnections<C extends Connection>(integration: { connections: ReadonlyArray<C> }) {
  return integration.connections.filter(
    (connection): connection is Extract<C, { type: "credential" }> => connection.type === "credential",
  )
}

/** Every connection in words: credential labels and `$VARIABLE` names. */
export function connectionSummary(integration: { connections: ReadonlyArray<Connection> }) {
  return integration.connections
    .map((connection) => (connection.type === "credential" ? connection.label : `$${connection.name}`))
    .join(", ")
}
