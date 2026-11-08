import type { OpenCodeEvent } from "@opencode/client/promise"
import { createClientConnection, createPtyClient, type ClientConnectionStatus } from "@opencode/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, on, onCleanup } from "solid-js"
import { createApiForServer, type ServerApi } from "@/runtime/server/api"
import { createMediaCache, type MediaCache } from "@/runtime/server/media"
import { setMediaBlobLoader } from "@/runtime/persistence/drafts"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "./registry"
import { createRefCountMap } from "@/runtime/server/refcount"
import { createRequestQueue } from "@/runtime/server/request-queue"
import { ServerScope } from "@/runtime/server/scope"
import { useServer } from "./current"
import { createEndpointSyncState, transitionEndpointSync, type EndpointSyncEvent } from "./server-sync/endpoint-machine"

type OpenCodeEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export type OpenCodeEventStream = {
  on<Type extends OpenCodeEvent["type"]>(type: Type, handler: (event: OpenCodeEventMap[Type]) => void): VoidFunction
  listen(handler: (event: OpenCodeEvent) => void): VoidFunction
}

type OpenCodeEventSource = OpenCodeEventStream & {
  location(directory: string): OpenCodeEventStream
}

export function createOpenCodeEventSource() {
  const emitter = createGlobalEmitter<OpenCodeEventMap>()

  function stream(directory?: string): OpenCodeEventStream {
    return {
      on(type, handler) {
        return emitter.on(type, (event) => {
          if (directory !== undefined && event.location?.directory !== directory) return
          handler(event)
        })
      },
      listen(handler) {
        return emitter.listen((event) => {
          if (directory !== undefined && event.details.location?.directory !== directory) return
          handler(event.details)
        })
      },
    }
  }

  const event: OpenCodeEventSource = {
    ...stream(),
    location: (directory) => stream(directory),
  }

  onCleanup(() => emitter.clear())

  return {
    event,
    publish(event: OpenCodeEvent) {
      emitter.emit(event.type, event)
    },
  }
}

export type ServerConnectionStatus = ClientConnectionStatus

type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  url: string
  http: ServerConnection.HttpBase
  api: ServerApi
  media: MediaCache
  pty: ReturnType<typeof createPtyClient>
  connection: {
    status: Accessor<ServerConnectionStatus>
    attempt: Accessor<number>
    error: Accessor<string | undefined>
  }
  event: OpenCodeEventSource
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const transport = createServerTransport({ http: server.http, fetch: platform.fetch, client: clientIdentity(platform) })
  const media = createMediaCache(() => transport.api)
  const serverKey = String(ServerConnection.key(server))
  setMediaBlobLoader(serverKey, (uri) => media.load(uri))
  onCleanup(() => {
    setMediaBlobLoader(serverKey, undefined)
    media.dispose()
  })

  const events = createOpenCodeEventSource()
  const reconnect = server.type === "extension" || server.type === "sidecar" ? server.reconnect : undefined
  let endpoint = createEndpointSyncState(transport.http)

  function dispatchEndpoint(event: EndpointSyncEvent) {
    const result = transitionEndpointSync(endpoint, event)
    endpoint = result.state
    result.effects.forEach((effect) => {
      if (effect.type === "transport.update") return void transport.update(effect.http)
      connection.internal.resync("Server endpoint changed")
    })
  }

  const connection = createClientConnection(transport.api, {
    reconnect: reconnect
      ? async (signal) => {
          dispatchEndpoint({ type: "resolve.started" })

          if (endpoint.type !== "resolving") return transport.api
          const attempt = endpoint.attempt
          const resolution = reconnect(signal)
          void resolution.catch(() => dispatchEndpoint({ type: "resolve.failed", attempt }))

          return resolution.then((http) => {
            dispatchEndpoint({ type: "resolve.succeeded", attempt, http })

            return transport.api
          })
        }
      : undefined,
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(event) {
      events.publish(event)
    },
    log: {
      info(message, data) {
        if (message !== "event stream disconnected") return
        console.info("[global-sdk] event stream disconnected", { url: transport.url, managed: !!reconnect, ...data })
      },
    },
  })

  if (server.type === "extension" || server.type === "sidecar") {
    createEffect(
      on(
        () => `${server.http.url}\0${server.http.password ?? ""}`,
        () => dispatchEndpoint({ type: "endpoint.reported", http: server.http }),
        { defer: true },
      ),
    )
  }
  onCleanup(() => {
    dispatchEndpoint({ type: "disposed" })
    transport.dispose()
  })

  return {
    server,
    scope,
    get url() {
      return transport.url
    },
    get http() {
      return transport.http
    },
    get api() {
      return transport.api
    },
    media,
    get pty() {
      return transport.pty
    },
    connection,
    event: events.event,
  }
}

export function createServerTransport(input: {
  http: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
  client?: { id: string; surface: "desktop" | "web"; version?: string }
}): {
  update(http: ServerConnection.HttpBase): ServerApi
  readonly url: string
  readonly http: ServerConnection.HttpBase
  readonly api: ServerApi
  readonly pty: ReturnType<typeof createPtyClient>
  dispose(): void
} {
  const queue = createRequestQueue({ fetch: input.fetch ?? globalThis.fetch })

  const build = (endpoint: ServerConnection.HttpBase) => {
    const http = { url: endpoint.url, password: endpoint.password }
    const api = createApiForServer({ server: http, fetch: queue.fetch, client: input.client })

    return { http, api, pty: createPtyClient(api, { url: http.url }) }
  }

  const state = { current: build(input.http) }

  return {
    update(http: ServerConnection.HttpBase) {
      if (sameEndpoint(http, state.current.http)) return state.current.api
      state.current = build(http)

      return state.current.api
    },
    get url() {
      return state.current.http.url
    },
    get http() {
      return state.current.http
    },
    get api() {
      return state.current.api
    },
    get pty() {
      return state.current.pty
    },
    dispose: queue.dispose,
  }
}

function sameEndpoint(a: ServerConnection.HttpBase, b: ServerConnection.HttpBase) {
  return a.url === b.url && a.password === b.password
}

function clientIdentity(platform: ReturnType<typeof usePlatform>) {
  if (platform.platform === "desktop")
    return { id: platform.windowID, surface: platform.platform, version: platform.version }
  const key = "redcode.client.id"
  const existing = (() => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  })()
  const id = existing || crypto.randomUUID()
  if (!existing)
    try {
      window.localStorage.setItem(key, id)
    } catch {
      // Private browsing may expose storage but reject writes; the runtime identity remains stable for this page.
    }
  return { id, surface: platform.platform, version: platform.version }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)

  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const useServerSDK = () => {
  const server = useServer()

  return server.ctx.sdk
}

export type LocationContext = {
  directory: string
  event: OpenCodeEventStream
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): LocationContext {
  return {
    directory,
    event: serverSDK.event.location(directory),
  }
}
