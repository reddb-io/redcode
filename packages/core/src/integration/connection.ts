export * as IntegrationConnection from "./connection.js"

import { Connection } from "@opencode/schema/connection"

export const CredentialInfo = Connection.CredentialInfo
export type CredentialInfo = Connection.CredentialInfo

export const EnvInfo = Connection.EnvInfo
export type EnvInfo = Connection.EnvInfo

export const Info = Connection.Info
export type Info = Connection.Info

export function ref(connection: Info): Connection.Ref {
  return connection.type === "credential" ? { type: connection.type, id: connection.id } : connection
}

/** Identity of an access choice; labels and refreshed token values do not identify a new connection. */
export function key(
  connection:
    | { readonly type: "credential"; readonly id: string }
    | { readonly type: "env"; readonly name: string }
    | undefined,
) {
  if (!connection) return undefined
  return connection.type === "credential" ? `credential:${connection.id}` : `env:${connection.name}`
}
