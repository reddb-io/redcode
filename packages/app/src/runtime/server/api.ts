import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`opencode:${input.password}`)
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient
