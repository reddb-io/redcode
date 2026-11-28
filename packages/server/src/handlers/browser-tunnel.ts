import { NodeHttpServerRequest } from "@effect/platform-node"
import { BrowserTunnelGateway } from "@opencode/core/browser-tunnel"
import { BrowserTunnelHost } from "@opencode/plugin-browser/tunnel-host"
import { BrowserTunnelSocket } from "@opencode/plugin-browser/websocket"
import { Effect, Layer } from "effect"
import { HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { IncomingMessage } from "node:http"
import path from "node:path"
import { isAllowedRequestOrigin, type CorsOptions } from "../cors"

export function browserTunnelRoutes(gateway: ReturnType<typeof BrowserTunnelGateway.make>, cors: CorsOptions) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const wss = yield* Effect.acquireRelease(Effect.sync(BrowserTunnelSocket.makeServer), (server) =>
        Effect.sync(() => {
          server.clients.forEach((socket) => socket.terminate())
          server.close()
        }),
      )
      return HttpRouter.add("GET", BrowserTunnelHost.BROWSER_TUNNEL_PATH, (request) =>
        Effect.gen(function* () {
          const incoming = NodeHttpServerRequest.toIncomingMessage(request)
          if (!(incoming instanceof IncomingMessage) || !BrowserTunnelGateway.isUpgrade(request))
            return HttpServerResponse.empty({ status: 400 })
          if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors))
            return HttpServerResponse.empty({ status: 403 })
          // The upgrade effect is lazy. Check that this is a real upgrade request before taking the ticket.
          const upgrade = yield* Effect.option(request.upgrade)
          if (upgrade._tag === "None") return HttpServerResponse.empty({ status: 400 })
          const query = new URL(request.url, "http://localhost").searchParams
          const ticket = request.headers[BrowserTunnelHost.TICKET_HEADER]
          const sessionID = request.headers[BrowserTunnelHost.SESSION_HEADER]
          const connectionID = request.headers[BrowserTunnelHost.CONNECTION_HEADER]
          const directory = query.get("location[directory]")
          if (!ticket || !sessionID || !connectionID || !directory || query.has("ticket"))
            return HttpServerResponse.empty({ status: 403 })
          const binding = gateway.take({
            ticket,
            sessionID,
            connectionID,
            directory: process.platform === "win32" ? path.normalize(directory) : directory,
            workspaceID: query.get("location[workspace]") ?? undefined,
          })
          if (!binding) return HttpServerResponse.empty({ status: 403 })

          const socket = yield* Effect.acquireRelease(
            Effect.callback<{ socket: BrowserTunnelSocket.Socket; binary: BrowserTunnelHost.BinarySocket }, Error>(
              (resume) => {
                const onClose = () => resume(Effect.fail(new Error("Browser tunnel closed during upgrade.")))
                if (incoming.socket.destroyed) return onClose()
                incoming.socket.once("close", onClose)
                // The WS client sends frames only after receiving the upgrade response.
                wss.handleUpgrade(incoming, incoming.socket, Buffer.alloc(0), (socket) => {
                  incoming.socket.off("close", onClose)
                  incoming.socket.setNoDelay(true)
                  socket.pause()
                  resume(Effect.succeed({ socket, binary: BrowserTunnelSocket.adapt(socket) }))
                })
                return Effect.sync(() => {
                  incoming.socket.off("close", onClose)
                })
              },
            ),
            ({ socket }) =>
              Effect.gen(function* () {
                if (socket.readyState === socket.CLOSED) return
                const closed = Effect.callback<void>((resume) => {
                  const notify = () => resume(Effect.void)
                  socket.once("close", notify)
                  socket.close(1001, "browser tunnel closed")
                  return Effect.sync(() => {
                    socket.off("close", notify)
                  })
                })
                const result = yield* Effect.timeoutOption(closed, "2 seconds")
                if (result._tag === "None") socket.terminate()
              }),
          )
          yield* HttpMiddleware.withLoggerDisabled(Effect.void)
          yield* binding.onUpgrade(socket.binary)
          return HttpServerResponse.empty()
        }).pipe(
          Effect.scoped,
          Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
        ),
      )
    }),
  )
}
