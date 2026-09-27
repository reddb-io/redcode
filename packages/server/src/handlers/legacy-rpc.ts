import { Session } from "@opencode/core/session"
import { LegacyRpcApi, RpcMaxBodyBytes } from "@opencode/protocol/groups/legacy-rpc"
import { ActiveSessionsResponse, RpcSessionListInput, SessionsResponse } from "@opencode/protocol/groups/session"
import { MultiRpc, Server, contentTypeFor, detectProtocol, encodeMessage } from "@reddb-io/multi-rpc"
import { decode } from "@reddb-io/toon"
import { RpcError } from "@reddb-io/toon-rpc"
import { Effect, FileSystem, Schema } from "effect"
import { HttpIncomingMessage, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { activeSessions, listSessions } from "../session-read"

export const LegacyRpcHandler = HttpApiBuilder.group(LegacyRpcApi, "server.legacy-rpc", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const server = new Server()

    server.register("health.get", async (params) => {
      requireNoParams(params)
      return { healthy: true }
    })
    server.register("session.list", async (params) => {
      const input = await Effect.runPromise(
        Schema.decodeUnknownEffect(RpcSessionListInput)(params).pipe(
          Effect.mapError(() => new RpcError(-32602, "Invalid params")),
        ),
      )
      const result = await Effect.runPromise(
        listSessions(session, input).pipe(
          Effect.catchTag("InvalidCursorError", () => Effect.fail(new RpcError(-32602, "Invalid params"))),
        ),
      )
      return Effect.runPromise(Schema.encodeEffect(SessionsResponse)(result))
    })
    server.register("session.active", async (params) => {
      requireNoParams(params)
      return Effect.runPromise(Schema.encodeEffect(ActiveSessionsResponse)(await Effect.runPromise(activeSessions(session))))
    })

    const multi = new MultiRpc(server)
    return handlers.handleRaw(
      "legacy-rpc.handle",
      Effect.fn("LegacyRpc.handle")(function* (ctx) {
        const contentType = ctx.request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
        if (contentType !== "application/json" && contentType !== "application/toon")
          return HttpServerResponse.text("Unsupported Media Type", { status: 415 })

        const contentLength = Number(ctx.request.headers["content-length"])
        if (Number.isFinite(contentLength) && contentLength > RpcMaxBodyBytes)
          return HttpServerResponse.text("Payload Too Large", { status: 413 })

        const body = yield* ctx.request.arrayBuffer.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(RpcMaxBodyBytes)),
          Effect.map((value) => new Uint8Array(value)),
          Effect.orElseSucceed(() => undefined),
        )
        if (!body || body.byteLength > RpcMaxBodyBytes)
          return HttpServerResponse.text("Payload Too Large", { status: 413 })

        const protocol = detectProtocol(body, contentType)
        if (isBatch(body, protocol))
          return HttpServerResponse.text(
            encodeMessage(
              { error: { code: -32600, message: "Invalid Request: batches are not supported" }, id: null },
              protocol,
            ),
            { status: 400, contentType: contentTypeFor(protocol) },
          )

        const response = yield* Effect.promise(() => multi.handleWithProtocol(body, contentType))
        return HttpServerResponse.uint8Array(response.body, {
          status: response.body.byteLength === 0 ? 204 : 200,
          contentType: contentTypeFor(response.protocol),
        })
      }),
    )
  }),
)

function requireNoParams(params: unknown) {
  if (Array.isArray(params) && params.length === 0) return
  if (params !== null && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length === 0)
    return
  throw new RpcError(-32602, "Invalid params")
}

function isBatch(body: Uint8Array, protocol: "jsonrpc" | "toonrpc") {
  const parsed = Effect.runSync(
    Effect.try({
      try: () => {
        const text = new TextDecoder().decode(body)
        return protocol === "jsonrpc" ? JSON.parse(text) : decode(text)
      },
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined)),
  )
  return Array.isArray(parsed)
}
