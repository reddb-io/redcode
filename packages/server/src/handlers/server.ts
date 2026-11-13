import { sql } from "drizzle-orm"
import * as NodeStream from "@effect/platform-node/NodeStream"
import { createReadStream } from "node:fs"
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
import { ServerCapabilities } from "@opencode/schema/server-capabilities"
import type { RemoteAccessHost } from "../remote-access"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"
import { database, runtime } from "../system-info"
import { attention } from "../attention"
import { createHostResources } from "../host-resources"
import { executionMemory } from "../execution-memory"
import { EventFeed } from "../event-feed"
import { modelPerformance } from "../model-performance"
import { startMemoryDiagnostics } from "../memory-diagnostics"
import { createMemoryCaptures } from "../memory-captures"
import { ContentHeaders } from "../content-headers"

const capabilities = ServerCapabilities.Info.make({
  protocol: ServerCapabilities.Protocol.make(1),
  features: {
    [ServerCapabilities.Feature.eventAcknowledgement]: ServerCapabilities.Version.make(1),
    [ServerCapabilities.Feature.eventResume]: ServerCapabilities.Version.make(1),
    [ServerCapabilities.Feature.executionGraph]: ServerCapabilities.Version.make(1),
    [ServerCapabilities.Feature.sessionObservation]: ServerCapabilities.Version.make(1),
    [ServerCapabilities.Feature.workerLease]: ServerCapabilities.Version.make(1),
    [ServerCapabilities.Feature.memoryCaptures]: ServerCapabilities.Version.make(1),
  },
  // Old coordinators still require these fields while the versioned map rolls out.
  sessionObservation: true,
  workerLease: true,
})

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const auth = yield* ServerAuth.Config
    const feed = yield* EventFeed.Service
    const global = yield* Global.Service
    yield* startMemoryDiagnostics
    const captures = yield* Effect.promise(() => createMemoryCaptures(global.state))
    yield* Effect.addFinalizer(() => Effect.sync(() => captures.close()))
    const resources = createHostResources()
    const administration = Effect.gen(function* () {
      const principal = yield* ServerAccess.Current
      if (principal && principal.access.ownerRole !== "admin")
        return yield* new ConsoleForbiddenError({
          message: "Infrastructure administration is required for diagnostics",
        })
    })
    const invalid = (cause: unknown) =>
      new InvalidRequestError({ message: cause instanceof Error ? cause.message : "Diagnostic request failed" })
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
      .handle("server.memory", () =>
        Effect.gen(function* () {
          const principal = yield* ServerAccess.Current
          if (principal && principal.access.ownerRole !== "admin")
            return yield* new ConsoleForbiddenError({
              message: "Infrastructure administration is required for execution memory",
            })
          return yield* executionMemory()
        }),
      )
      .handle("server.memoryCaptures", () => administration.pipe(Effect.andThen(Effect.promise(() => captures.list()))))
      .handle("server.startMemoryCapture", (ctx) =>
        Effect.gen(function* () {
          yield* administration
          if (ctx.payload.target.kind === "process") {
            const pid = ctx.payload.target.pid
            const snapshot = yield* executionMemory()
            if (!snapshot.entries.some((entry) => entry.pid === pid))
              return yield* invalid(new Error("The process is not owned by a visible Redcode execution"))
          }
          return yield* Effect.tryPromise({
            try: () => captures.start(ctx.payload),
            catch: invalid,
          })
        }),
      )
      .handle("server.cancelMemoryCapture", (ctx) =>
        administration.pipe(
          Effect.andThen(Effect.tryPromise({ try: () => captures.cancel(ctx.params.id), catch: invalid })),
        ),
      )
      .handle("server.deleteMemoryCapture", (ctx) =>
        administration.pipe(
          Effect.andThen(Effect.tryPromise({ try: () => captures.delete(ctx.params.id), catch: invalid })),
        ),
      )
      .handleRaw("server.downloadMemoryCapture", (ctx) =>
        Effect.gen(function* () {
          yield* administration
          const capture = yield* Effect.try({ try: () => captures.download(ctx.params.id), catch: invalid })
          const stream = NodeStream.fromReadable({
            evaluate: () => createReadStream(capture.file),
            onError: invalid,
          })
          return HttpServerResponse.stream(stream, {
            contentLength: capture.capture.size,
            headers: ContentHeaders.download({
              path: capture.capture.filename,
              mime: capture.capture.kind === "samples" ? "application/json" : "application/octet-stream",
            }),
          })
        }),
      )
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
            capabilities,
            pid: process.pid ?? 0,
            urls: info.urls(),
            paths: info.paths,
          }
        }),
      )
      .handle("server.system", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
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
              eventFeed: yield* feed.diagnostics,
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
            clients: yield* feed.snapshot,
            ...(counted ? { counts: counted } : {}),
          }
        }),
      )
      .handle("server.performance", () => modelPerformance())
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
              // Public access terminates TLS at the Redcode relay and forwards the original scheme.
              secure: request.headers["x-forwarded-proto"]?.split(",")[0]?.trim().toLowerCase() === "https",
              maxAge: Duration.seconds(ServerAuth.SESSION_TTL_SECONDS),
            }),
          )
        }),
      )
  }),
)
