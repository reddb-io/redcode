import { sql } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { Duration, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { UnauthorizedError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"
import { database, runtime } from "../system-info"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const auth = yield* ServerAuth.Config

    return handlers
      .handle("server.info", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return {
            version: info.app.version ?? "unknown",
            pid: process.pid ?? 0,
            urls: info.urls(),
            paths: info.paths,
          }
        }),
      )
      .handle("server.system", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          const global = yield* Global.Service
          const storage = yield* Database.Service
          const counted = yield* Effect.gen(function* () {
            const [sessions] = yield* storage.db.all<{ total: number }>(sql`SELECT count(*) AS total FROM session_v2`)
            const [messages] = yield* storage.db.all<{ total: number }>(
              sql`SELECT count(*) AS total FROM session_message`,
            )
            return { sessions: sessions?.total ?? 0, messages: messages?.total ?? 0 }
          }).pipe(Effect.orElseSucceed(() => undefined))
          return {
            version: info.app.version ?? "unknown",
            runtime: runtime(),
            platform: `${process.platform} ${process.arch}`,
            pid: process.pid ?? 0,
            started: info.started,
            memory: process.memoryUsage().rss,
            urls: info.urls(),
            paths: {
              config: global.config,
              data: global.data,
              state: global.state,
              cache: global.cache,
              log: global.log,
              tmp: global.tmp,
            },
            database: yield* Effect.promise(() => database(info.database)),
            ...(counted ? { counts: counted } : {}),
          }
        }),
      )
      .handle("server.pair", () => pairing.issue())
      .handle("server.cancelPair", (ctx) => pairing.consume(ctx.params.code).pipe(Effect.asVoid))
      .handle(
        "server.connect",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // Browser navigations ask for HTML; everything else is an API client that wants the token.
          const browser = request.headers.accept?.includes("text/html") === true
          const token = (yield* pairing.consume(ctx.params.code)) ? ServerAuth.issueSession(auth) : undefined
          if (token === undefined) {
            if (!browser) return yield* new UnauthorizedError({ message: "Pairing link expired or already used" })
            return HttpServerResponse.text(
              "This pairing link expired or was already used. Run `redcode pair` to get a new one.",
              { status: 401 },
            )
          }
          if (!browser) return { token }
          return HttpServerResponse.redirect("/").pipe(
            HttpServerResponse.setCookieUnsafe(ServerAuth.sessionCookieName(request.headers.host), token, {
              path: "/",
              httpOnly: true,
              sameSite: "lax",
              maxAge: Duration.seconds(ServerAuth.SESSION_TTL_SECONDS),
            }),
          )
        }),
      )
  }),
)
