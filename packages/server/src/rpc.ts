import { SessionV2 } from "@opencode-ai/core/session"
import { MultiRpc, Server, contentTypeFor, detectProtocol, encodeMessage } from "@reddb-io/multi-rpc"
import { decode } from "@reddb-io/toon"
import { RpcError } from "@reddb-io/toon-rpc"
import { RpcApi, RpcMaxBodyBytes, RpcMethods } from "@opencode-ai/protocol/rpc"
import { Effect, FileSystem, Schema } from "effect"
import { HttpIncomingMessage, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { activeSessions, listSessions } from "./session-read"

export const RpcHandler = HttpApiBuilder.group(RpcApi, "rpc", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const server = new Server()

    server.register(RpcMethods.healthGet.name, async (params) => {
      requireNoParams(params)
      return { healthy: true }
    })
    server.register(RpcMethods.sessionList.name, async (params) => {
      const input = await Effect.runPromise(
        Schema.decodeUnknownEffect(RpcMethods.sessionList.params)(params).pipe(
          Effect.mapError(() => new RpcError(-32602, "Invalid params")),
        ),
      )
      const result = await Effect.runPromise(
        listSessions(session, input).pipe(
          Effect.catchTag("InvalidCursorError", () => Effect.fail(new RpcError(-32602, "Invalid params"))),
        ),
      )
      return Effect.runPromise(Schema.encodeEffect(RpcMethods.sessionList.result)(result))
    })
    server.register(RpcMethods.sessionActive.name, async (params) => {
      requireNoParams(params)
      return Effect.runPromise(activeSessions(session))
    })

    const multi = new MultiRpc(server)
    return handlers.handleRaw(
      "handle",
      Effect.fn("Rpc.handle")(function* (ctx) {
        const contentType = ctx.request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
        if (contentType !== "application/json" && contentType !== "application/toon")
          return HttpServerResponse.text("Unsupported Media Type", { status: 415 })

        const contentLength = Number(ctx.request.headers["content-length"])
        if (Number.isFinite(contentLength) && contentLength > RpcMaxBodyBytes)
          return HttpServerResponse.text("Payload Too Large", { status: 413 })

        const body = yield* ctx.request.arrayBuffer.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(RpcMaxBodyBytes)),
          Effect.map((value) => new Uint8Array(value)),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (!body || body.byteLength > RpcMaxBodyBytes)
          return HttpServerResponse.text("Payload Too Large", { status: 413 })

        const protocol = detectProtocol(body, contentType)
        if (isBatch(body, protocol)) {
          return HttpServerResponse.text(
            encodeMessage(
              {
                error: { code: -32600, message: "Invalid Request: batches are not supported" },
                id: null,
              },
              protocol,
            ),
            { status: 400, contentType: contentTypeFor(protocol) },
          )
        }

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
    }).pipe(Effect.catch(() => Effect.succeed(undefined))),
  )
  return Array.isArray(parsed)
}
