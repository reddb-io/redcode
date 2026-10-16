import { sql } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { Duration, Effect, RcMap } from "effect"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionExecution } from "@opencode/core/session/execution"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError, UnauthorizedError } from "@opencode/protocol/errors"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { ServerAccess } from "@opencode/protocol/server-access"
import type { RemoteAccessHost } from "../remote-access"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"
import { database, runtime } from "../system-info"
import { attention } from "../attention"
import { createHostResources } from "../host-resources"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const auth = yield* ServerAuth.Config
    const resources = createHostResources()
    const remote = <A>(operation: (host: RemoteAccessHost.Interface | undefined) => Promise<A>) =>
      Effect.gen(function* () {
        const principal = yield* ServerAccess.Current
        if (principal && principal.access.ownerRole !== "admin")
          return yield* new ConsoleForbiddenError({
            message: "Infrastructure administration is required for HTTPS access",
          })
        const info = yield* ServerInfo.Service
        return yield* Effect.tryPromise({
          try: () => operation(info.remoteAccess),
          catch: () => new InvalidRequestError({ message: "Unable to change HTTPS access on this host" }),
        })
      })

    return handlers
      .handle("server.remoteAccess", () =>
        remote(async (host) => host?.status() ?? { available: false, state: "disabled" as const }),
      )
      .handle("server.configureRemoteAccess", (ctx) =>
        remote(async (host) => {
          if (!host) throw new Error("This host does not provide HTTPS setup")
          return host.configure(ctx.payload)
        }),
      )
      .handle("server.disableRemoteAccess", () =>
        remote(async (host) => {
          if (!host) throw new Error("This host does not provide HTTPS setup")
          return host.disable()
        }),
      )
      .handle("server.resources", () => Effect.promise(resources))
      .handle("server.attention", () => attention())
      .handle("server.info", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return {
            version: info.app.version ?? "unknown",
            capabilities: { sessionObservation: true, workerLease: true },
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
          const locations = yield* LocationServiceMap.Service
          const execution = yield* SessionExecution.Service
          const usage = process.memoryUsage()
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
            memory: usage.rss,
            processMemory: {
              heapUsed: usage.heapUsed,
              heapTotal: usage.heapTotal,
              external: usage.external,
              arrayBuffers: usage.arrayBuffers,
            },
            activity: {
              cachedLocations: Array.from(yield* RcMap.keys(locations.rcMap)).length,
              activeExecutions: Array.from(yield* execution.active).length,
            },
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
