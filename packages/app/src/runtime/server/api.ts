import {
  OpenCode,
  type MessageListInput,
  type OpenCodeClient,
  type SessionMessageGetInput,
} from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { ClientPresence } from "@opencode/schema/client-presence"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`opencode:${input.password}`)
}

export const MEDIA_URI_CAPABILITY = "experimental-media-uri"
export const CAPABILITIES_HEADER = "X-OpenCode-Capabilities"

/** Set `mediaRefs: false` for self-contained reads such as transcript export. */
export type ServerRequestOptions = OpenCode.RequestOptions & { readonly mediaRefs?: false }

export type ServerApi = Omit<OpenCodeClient, "message" | "session"> & {
  message: Omit<OpenCodeClient["message"], "list"> & {
    list: (
      input: MessageListInput,
      options?: ServerRequestOptions,
    ) => ReturnType<OpenCodeClient["message"]["list"]>
  }
  session: Omit<OpenCodeClient["session"], "message"> & {
    message: Omit<OpenCodeClient["session"]["message"], "get"> & {
      get: (
        input: SessionMessageGetInput,
        options?: ServerRequestOptions,
      ) => ReturnType<OpenCodeClient["session"]["message"]["get"]>
    }
  }
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
  client?: { id: string; surface: "desktop" | "web"; version?: string }
}): ServerApi {
  const headers = new Headers()
  if (input.server.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({
        password: input.server.password,
      })}`,
    )
  if (input.client) {
    headers.set(ClientPresence.SURFACE_HEADER, input.client.surface)
    headers.set(ClientPresence.CLIENT_ID_HEADER, input.client.id)
    if (input.client.version) headers.set(ClientPresence.VERSION_HEADER, input.client.version)
  }
  return withMediaRefs(
    OpenCode.make({
      baseUrl: input.server.url,
      fetch: input.fetch,
      headers,
    }),
  )
}

function withMediaRefs(api: OpenCodeClient): ServerApi {
  return {
    ...api,
    message: {
      ...api.message,
      list: (input: MessageListInput, options?: ServerRequestOptions) =>
        api.message.list(input, mediaRefOptions(options)),
    },
    session: {
      ...api.session,
      message: {
        ...api.session.message,
        get: (input: SessionMessageGetInput, options?: ServerRequestOptions) =>
          api.session.message.get(input, mediaRefOptions(options)),
      },
    },
  }
}

function mediaRefOptions(options: ServerRequestOptions | undefined): OpenCode.RequestOptions | undefined {
  if (options?.mediaRefs === false) return options
  const headers = new Headers(options?.headers)
  headers.set(CAPABILITIES_HEADER, MEDIA_URI_CAPABILITY)
  return { ...options, headers }
}
