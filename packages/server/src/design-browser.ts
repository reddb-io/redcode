export * as DesignBrowser from "./design-browser"

import { Design } from "@opencode/schema/design"
import { Agent } from "@opencode/schema/agent"
import type { Location } from "@opencode/schema/location"
import { TuiEvent } from "@opencode/schema/tui-event"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { DesignFeed } from "@opencode/core/design/feed"
import { DesignAppBinary } from "@opencode/core/design/app-binary"
import { DesignAppConnection } from "@opencode/core/design/app-connection"
import { DesignAppMode } from "@opencode/core/design/app-mode"
import { DesignFeedback } from "@opencode/core/design/feedback"
import { DesignHandoff } from "@opencode/core/design/handoff"
import { DesignHost } from "@opencode/core/design/host"
import { DesignRenderer } from "@opencode/core/design/renderer"
import { DesignRuntime } from "@opencode/core/design/runtime"
import { DesignStore } from "@opencode/core/design/store"
import { Permission } from "@opencode/core/permission"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Cause, Duration, Effect, Exit, Option, RcMap, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { ServerAuth } from "./auth"
import { CorsConfig } from "./cors"
import { DesignAccess } from "./design-access"
import { DesignBrowserPermissions } from "./design-browser-permissions"
import { DesignPresence } from "./design-presence"
import { authorizedRequest } from "./middleware/authorization"

const previewCSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
const pageCSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:"
/** The design app serves these routes too, under this app name. */
const DESIGN_APP = "redcode-design"
const DesignPermission = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("read"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tooling"), designID: Design.ID }),
])

/**
 * `hosts` are the names this server answers to besides its own; `network` is its origin for another device on the
 * local network, undefined while it listens only on loopback.
 */
export const routes = (hosts: () => ReadonlyArray<string>, network: () => string | undefined = () => undefined) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const execution = yield* SessionExecution.Service
      const goals = yield* SessionGoal.Service
      const instances = yield* Instance.Service
      const auth = yield* ServerAuth.Config
      const app = yield* App.Metadata
      const appConnection = yield* DesignAppConnection.Service
      const secret = Option.getOrElse(auth.password, () => DesignAccess.embeddedSecret())
      const previews = new Map<string, "building" | "ready" | "failed">()
      const bus = yield* Bus.Service
      const fork = Effect.runForkWith(yield* Effect.context<never>())
      const downloads = new Set<string>()
      const cors = yield* CorsConfig
      const locations = yield* LocationServiceMap.Service

      /** A review link to this server at the address the client used, signed so a browser needs no credentials. */
      const reviewLink = (host: string | undefined, sessionID: SessionSchema.ID) => {
        const link = new URL(`/design/session/${sessionID}/review`, DesignAccess.reviewOrigin(host))
        link.searchParams.set("ticket", DesignAccess.ticket(secret, sessionID))
        return link.toString()
      }
      /**
       * The same review at this server's network address, unless the client already used that address.
       */
      const networkLink = (host: string | undefined, sessionID: SessionSchema.ID) => {
        const origin = network()
        if (!origin || new URL(origin).origin === DesignAccess.reviewOrigin(host)) return undefined
        return reviewLink(new URL(origin).host, sessionID)
      }

      /** Starts or joins the design app; a first-use download shows its progress in the Session's TUIs. */
      const connectApp = (version: string | undefined, location: Location.Ref) => {
        const connecting = appConnection.connect(version)
        const key = `${location.workspaceID ?? ""}:${location.directory}`
        // A waiting page reloads every second; one watcher per location keeps the toasts from multiplying.
        if (downloads.has(key)) return connecting
        downloads.add(key)
        const stop = DesignAppBinary.watch((progress) => {
          if (progress?.phase !== "download") return
          fork(
            bus.publish(
              TuiEvent.ToastShow,
              { message: DesignAppBinary.describe(progress), variant: "info", duration: 8_000 },
              { location },
            ),
          )
        })
        const done = () => {
          stop()
          downloads.delete(key)
        }
        connecting.then(done, done)
        return connecting
      }

      /** The design app's URL for a review route; none yet while the app still downloads or starts. */
      const appLink = (sessionID: SessionSchema.ID, route: string, location: Location.Ref, version?: string) =>
        Effect.tryPromise({
          try: async () => {
            const { DesignApp } = await import("@opencode/core/design/app")
            return DesignApp.link(await connectApp(version, location), sessionID, route)
          },
          catch: (error) =>
            new Design.Error({
              code: "unavailable",
              message: `The design app did not start: ${error instanceof Error ? error.message : String(error)}`,
            }),
        }).pipe(Effect.timeoutOption("2 seconds"))

      const handle = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const route = yield* HttpRouter.RouteContext
        const sessionID = Option.getOrUndefined(Schema.decodeUnknownOption(SessionSchema.ID)(route.params.sessionID))
        if (!sessionID) return failure(400, "Invalid session")
        if (!DesignHost.allowed(request.headers.host, hosts()))
          return failure(403, "Design is not served under this host name")
        const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`)
        const parts = url.pathname.split("/").filter(Boolean).slice(3)
        const trusted = !ServerAuth.required(auth) || (yield* authorizedRequest(request, auth))
        const session = yield* sessions
          .get(sessionID)
          .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
        if (!session) return failure(404, `Session not found: ${sessionID}`)
        const configured = Effect.gen(function* () {
          const store = yield* DesignStore.Service
          return yield* store.configured(sessionID)
        }).pipe(instances.provide(session))
        const surface =
          ["review", "feed", "link"].includes(parts[0] ?? "") ||
          (parts[0] === "launch" && parts[1] !== "release") ||
          parts[1] === "present" ||
          (parts[1] === "revision" && parts[3] === "preview")
        if (surface && session.agent !== "design") {
          const ended = yield* Effect.gen(function* () {
            const store = yield* DesignStore.Service
            return (yield* store.list(sessionID)).some((document) => document.ended && !!document.approvedRevision)
          }).pipe(instances.provide(session))
          if (ended) return failure(410, "Design approved. Continue in the terminal with the implementation plan.")
        }
        if (parts[0] === "link" && parts.length === 1 && request.method === "GET") {
          if (!trusted) return failure(401, "Server authorization is required to create a review link")
          const design = yield* configured
          // A first download must not block the caller: the link to this server waits for the app on its own page.
          if (DesignAppMode.process(design))
            yield* appLink(sessionID, "/review", session.location, design?.app?.version)
          return HttpServerResponse.jsonUnsafe({
            url: reviewLink(request.headers.host, sessionID),
            network: networkLink(request.headers.host, sessionID),
            connected: DesignPresence.shared.connected(sessionID),
          })
        }
        // Clients claim a browser launch here and give the claim back when it fails, so one review opens one
        // tab: the review feed counts connected pages, and a publish right after a request opens no second one.
        if (
          parts[0] === "launch" &&
          request.method === "POST" &&
          (parts.length === 1 || (parts.length === 2 && parts[1] === "release"))
        ) {
          const refusal = DesignAccess.launchRefusal({
            trusted,
            origin: request.headers.origin,
            host: request.headers.host,
            contentType: request.headers["content-type"],
            cors,
          })
          if (refusal) return failure(refusal.status, refusal.message)
          if (parts[1] === "release") {
            const input = yield* request.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ token: Schema.Number }))),
            )
            DesignPresence.shared.release(sessionID, input.token)
            return HttpServerResponse.jsonUnsafe({ released: true })
          }
          const input = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ explicit: Schema.optional(Schema.Boolean) }))),
          )
          return HttpServerResponse.jsonUnsafe({
            ...DesignPresence.shared.claim(sessionID, { explicit: input.explicit === true }),
            url: reviewLink(request.headers.host, sessionID),
            network: networkLink(request.headers.host, sessionID),
            connected: DesignPresence.shared.connected(sessionID),
          })
        }
        const linked = !trusted && DesignAccess.verify(secret, sessionID, url.searchParams.get("ticket") ?? undefined)
        if (parts[0] === "permission" && parts.length === 1 && !trusted)
          return failure(401, "Server authorization is required for Design permissions")
        if (parts[1] === "revision" && parts[3] === "directory" && !trusted)
          return failure(401, "Server authorization is required for Design build paths")
        if (!trusted && !linked && !DesignAccess.verify(secret, sessionID, request.cookies[DesignAccess.COOKIE]))
          return failure(401, "This review link expired or belongs to another session; open the review again")
        if (request.method !== "GET") {
          const origin = request.headers.origin
          if (origin && URL.parse(origin)?.host !== request.headers.host)
            return failure(403, "Design refuses cross-origin writes")
          if (!request.headers["content-type"]?.startsWith("application/json"))
            return failure(403, "Design writes must be JSON")
        }
        // In app mode, attach the renderer to this Session while the review remains on this server.
        const page =
          request.method === "GET" &&
          ((parts[0] === "review" && parts.length === 1) || (parts[1] === "present" && parts.length === 2))
        const signed =
          DesignAccess.verify(secret, sessionID, url.searchParams.get("ticket") ?? undefined) ||
          DesignAccess.verify(secret, sessionID, request.cookies[DesignAccess.COOKIE])
        const design = page && signed && app.name !== DESIGN_APP ? yield* configured : undefined
        // Keep the browser on the owning server; another device cannot reach the app's loopback port.
        if (design && DesignAppMode.process(design))
          yield* appLink(sessionID, `/${parts.join("/")}`, session.location, design.app?.version)
        if (parts[0] === "share" && parts.length === 1 && request.method === "GET")
          return HttpServerResponse.jsonUnsafe({
            url:
              networkLink(request.headers.host, sessionID) ??
              (network() ? reviewLink(request.headers.host, sessionID) : undefined),
          })
        const response =
          parts[0] === "permission" && parts.length === 1
            ? request.method === "POST"
              ? yield* authorize(request, sessionID, session.agent).pipe(instances.provide(session))
              : failure(405, "Design permission requests must use POST")
            : request.method === "GET"
              ? yield* read(url, sessionID, parts, sessions, bus, app.version, previews).pipe(
                  instances.provide(session),
                )
              : yield* mutate(request, sessionID, parts, session.agent).pipe(instances.provide(session))
        if (!linked) return response
        return response.pipe(
          HttpServerResponse.setCookieUnsafe(
            DesignAccess.COOKIE,
            DesignAccess.ticket(secret, sessionID, DesignAccess.COOKIE_TTL),
            {
              path: `/design/session/${sessionID}`,
              httpOnly: true,
              sameSite: "strict",
              secure: url.protocol === "https:",
              maxAge: Duration.millis(DesignAccess.COOKIE_TTL),
            },
          ),
        )
      }).pipe(
        // Custom browser routes do not inherit the HttpApi request-service middleware.
        Effect.provideService(Session.Service, sessions),
        Effect.provideService(SessionExecution.Service, execution),
        Effect.provideService(SessionGoal.Service, goals),
        Effect.catchCause((cause) => Effect.succeed(errorResponse(Cause.squash(cause)))),
      )

      yield* router.add("*", "/design/session/:sessionID/*", handle)
      const launch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!DesignHost.allowed(request.headers.host, hosts()))
          return failure(403, "Design is not served under this host name")
        const trusted = !ServerAuth.required(auth) || (yield* authorizedRequest(request, auth))
        const { DesignLauncher } = yield* Effect.promise(() => import("@opencode/core/design/ui/launcher"))
        if (!trusted) {
          if (request.method !== "GET")
            return failure(401, "Connect this browser with redcode pair before creating sessions")
          return html(DesignLauncher.page({ authenticated: false, projects: [], reviews: [] }))
        }
        const refs = Array.from(yield* RcMap.keys(locations.rcMap))
        const recent = (yield* sessions.list({ limit: 100, parentID: null, order: "desc" })).data.filter((session) =>
          refs.some(
            (ref) => ref.directory === session.location.directory && ref.workspaceID === session.location.workspaceID,
          ),
        )
        if (request.method === "GET") {
          const projects = Array.from(
            Map.groupBy(
              recent,
              (session) => `${session.location.workspaceID ?? ""}:${session.location.directory}`,
            ).values(),
          ).map((items) => ({
            sessionID: items[0]!.id,
            title: items[0]!.title ?? items[0]!.location.directory,
            directory: items[0]!.location.directory,
          }))
          return html(
            DesignLauncher.page({
              authenticated: true,
              projects,
              reviews: recent
                .filter((session) => session.agent === "design")
                .map((session) => ({
                  title: session.title ?? session.location.directory,
                  directory: session.location.directory,
                  url: reviewLink(request.headers.host, session.id),
                })),
            }),
          )
        }
        const url = new URL(request.url, "http://localhost")
        if (request.method !== "POST" || url.pathname !== "/design/new")
          return failure(405, "Unsupported Design operation")
        if (request.headers.origin && URL.parse(request.headers.origin)?.host !== request.headers.host)
          return failure(403, "Design refuses cross-origin writes")
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return failure(403, "Design writes must be JSON")
        const input = yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ source: SessionSchema.ID }))),
        )
        const source = recent.find((session) => session.id === input.source)
        if (!source) return failure(409, "The selected project is no longer loaded; refresh Design and choose it again")
        const session = yield* sessions.create({
          location: source.location,
          agent: Agent.ID.make("design"),
          model: source.model,
          title: `Design · ${source.title ?? source.location.directory}`,
        })
        return HttpServerResponse.jsonUnsafe({
          sessionID: session.id,
          url: reviewLink(request.headers.host, session.id),
        })
      }).pipe(Effect.catchCause((cause) => Effect.succeed(errorResponse(Cause.squash(cause)))))
      yield* router.add("*", "/design", launch)
      yield* router.add("*", "/design/new", launch)
    }),
  )

function authorize(
  request: HttpServerRequest.HttpServerRequest,
  sessionID: SessionSchema.ID,
  agent: Agent.ID | undefined,
) {
  return Effect.gen(function* () {
    const input = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(DesignPermission)))
    if (input.kind === "tooling") {
      const store = yield* DesignStore.Service
      const document = yield* store.get(sessionID, input.designID)
      return HttpServerResponse.jsonUnsafe({
        granted: yield* DesignBrowserPermissions.tooling(sessionID, agent, document, "design.app"),
      })
    }
    const read = yield* DesignBrowserPermissions.reader(sessionID, agent, "design.app")
    const granted = yield* Effect.promise(() => read(input.path)).pipe(
      Effect.as(true),
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause)
        return error instanceof Permission.DeclinedError ||
          error instanceof Permission.CorrectedError ||
          error instanceof Permission.BlockedError
          ? Effect.succeed(false)
          : Effect.failCause(cause)
      }),
    )
    return HttpServerResponse.jsonUnsafe({ granted })
  })
}

function read(
  url: URL,
  sessionID: SessionSchema.ID,
  parts: string[],
  sessions: Session.Interface,
  bus: Bus.Interface,
  version: string,
  previews: Map<string, "building" | "ready" | "failed">,
) {
  return Effect.gen(function* () {
    const store = yield* DesignStore.Service
    const endpoint = `/design/session/${sessionID}`
    if (parts[0] === "todo" && parts.length === 1) {
      const todos = yield* SessionTodoStore.Service
      return HttpServerResponse.jsonUnsafe(SessionTodo.forAgent(yield* todos.get(sessionID), "design"))
    }
    if (parts[0] === "review" && parts.length === 1) {
      const { DesignPage } = yield* Effect.promise(() => import("@opencode/core/design/ui/page"))
      const configured = yield* store.configured(sessionID)
      return html(DesignPage.review(sessionID, endpoint, configured?.breakpoints))
    }
    if (parts[0] === "feed" && parts.length === 1) {
      const cursor = Number(url.searchParams.get("after") ?? "0")
      if (!Number.isSafeInteger(cursor) || cursor < 0) return failure(400, "Invalid feed cursor")
      const active = yield* sessions.active
      const at = Date.now()
      const info = yield* sessions.get(sessionID)
      const initial: Design.FeedEvent[] = [
        { type: "agent", seq: 0, at, agent: info.agent ?? "" },
        { type: "state", seq: 0, at, state: active.has(sessionID) ? "working" : "idle" },
      ]
      const events = Stream.make(...initial).pipe(
        Stream.concat(DesignFeed.stream(sessions, bus, sessionID).pipe(Stream.orDie)),
        Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`),
      )
      const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
      const body = events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText)
      // Each feed subscriber is one open review page, so launches know a tab already follows this Session.
      return HttpServerResponse.stream(Stream.unwrap(Effect.as(DesignPresence.hold(sessionID), body)), {
        contentType: "text/event-stream",
        headers: {
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff",
        },
      })
    }
    if (parts[0] === "whiteboard" && parts.length === 1) {
      const { DesignWhiteboard } = yield* Effect.promise(() => import("@opencode/core/design/whiteboard"))
      const frame = yield* Effect.promise(() => DesignWhiteboard.frame(version))
      return HttpServerResponse.text(frame, {
        contentType: "text/html",
        headers: {
          "cache-control": "no-store",
          "content-security-policy":
            "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:; worker-src blob:; form-action 'none'",
        },
      })
    }
    if (!parts.length) return HttpServerResponse.jsonUnsafe(yield* store.list(sessionID))
    const id = Option.getOrUndefined(Schema.decodeUnknownOption(Design.ID)(parts[0]))
    if (!id) return failure(400, "Invalid design")
    const document = yield* store.get(sessionID, id)
    if (parts.length === 1) return HttpServerResponse.jsonUnsafe(document)
    if (parts[1] === "revision" && parts.length === 2)
      return HttpServerResponse.jsonUnsafe(yield* store.revisions(sessionID, id))
    if (parts[1] === "revision" && parts[2] && parts[3] === "status" && parts.length === 4) {
      const preview = previews.get(`${sessionID}:${parts[2]}`)
      return HttpServerResponse.jsonUnsafe({
        stage: !preview ? "queued" : preview === "building" && DesignRuntime.installing() ? "tools" : preview,
      })
    }
    if (parts[1] === "revision" && parts[2] && parts[3] === "directory" && parts.length === 4) {
      const renderer = yield* DesignRenderer.Service
      const revision = yield* store.revision(sessionID, id, parts[2])
      return HttpServerResponse.jsonUnsafe({ path: yield* renderer.directory(revision) })
    }
    if (parts[1] === "revision" && parts[2] && parts[3] === "preview" && parts.length === 4) {
      const { DesignPage } = yield* Effect.promise(() => import("@opencode/core/design/ui/page"))
      const revision = yield* store.revision(sessionID, id, parts[2])
      const renderer = yield* DesignRenderer.Service
      const key = `${sessionID}:${revision.id}`
      previews.delete(key)
      previews.set(key, "building")
      if (previews.size > 500) previews.delete(previews.keys().next().value!)
      const content = yield* renderer.directory(revision).pipe(
        Effect.flatMap((directory) => Effect.promise(() => DesignPage.preview(revision, directory))),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            previews.set(key, Exit.isSuccess(exit) ? "ready" : "failed")
          }),
        ),
      )
      return HttpServerResponse.text(content, {
        contentType: "text/html",
        headers: {
          "cache-control": "private, no-cache",
          "content-security-policy": previewCSP,
        },
      })
    }
    if (parts[1] === "present" && parts.length === 2) {
      const { DesignPage } = yield* Effect.promise(() => import("@opencode/core/design/ui/page"))
      return html(
        DesignPage.present(
          endpoint,
          id,
          url.searchParams.get("view") === "presenter" ? "presenter" : "audience",
          url.searchParams.get("revision") ?? undefined,
        ),
      )
    }
    if (parts[1] === "asset" && parts.length === 2)
      return HttpServerResponse.jsonUnsafe(yield* store.assets(sessionID, id))
    if (parts[1] === "asset" && parts[2] && parts[3] === "file" && parts.length === 4) {
      const asset = yield* store.asset(sessionID, id, parts[2])
      return HttpServerResponse.uint8Array(yield* store.readBlob(asset.hash), {
        contentType: asset.mime,
        headers: { "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff" },
      })
    }
    if (parts[1] === "job" && parts.length === 2) {
      const renderer = yield* DesignRenderer.Service
      return HttpServerResponse.jsonUnsafe(yield* renderer.jobs(sessionID, id))
    }
    if (parts[1] === "job" && parts[2] && parts[3] === "file" && parts.length === 4) {
      const renderer = yield* DesignRenderer.Service
      const job = (yield* renderer.jobs(sessionID, id)).find((item) => item.id === parts[2])
      if (!job?.result || job.status !== "completed") return failure(404, "Completed export not found")
      const file = Design.exportFile(job.input.format)
      return yield* HttpServerResponse.file(job.result, {
        headers: {
          "content-type": file.mime,
          "content-disposition": `${job.input.format === "verify" ? "inline" : "attachment"}; filename="${job.id}.${file.extension}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        },
      })
    }
    if (parts[1] === "approval" && parts[2] && parts.length === 3)
      return HttpServerResponse.jsonUnsafe(yield* store.approval(sessionID, id, parts[2]))
    return failure(404, "Not found")
  })
}

function mutate(
  request: HttpServerRequest.HttpServerRequest,
  sessionID: SessionSchema.ID,
  parts: string[],
  agent: Agent.ID | undefined,
) {
  return Effect.gen(function* () {
    const store = yield* DesignStore.Service
    if (!parts.length && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Design.Create)),
          Effect.flatMap((input) => store.create(sessionID, input)),
        ),
      )
    const id = Option.getOrUndefined(Schema.decodeUnknownOption(Design.ID)(parts[0]))
    if (!id) return failure(400, "Invalid design")
    const document = yield* store.get(sessionID, id)
    if (parts.length === 1 && request.method === "PATCH")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Design.Update)),
          Effect.flatMap((input) => store.update(sessionID, id, input)),
        ),
      )
    if (parts[1] === "revision" && parts.length === 2 && request.method === "POST") {
      const input = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String }))),
      )
      const grants = yield* DesignBrowserPermissions.grants(sessionID, agent, document)
      return HttpServerResponse.jsonUnsafe(yield* store.publish(sessionID, id, input.name, grants.read, grants.tooling))
    }
    if (parts[1] === "restore" && parts.length === 2 && request.method === "POST") {
      const input = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ revision: Schema.String }))),
      )
      const grants = yield* DesignBrowserPermissions.grants(sessionID, agent, document)
      return HttpServerResponse.jsonUnsafe(
        yield* store.restore(sessionID, id, input.revision, grants.read, grants.tooling),
      )
    }
    if (parts[1] === "asset" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Design.ImportAsset)),
          Effect.flatMap((input) => store.importAsset(sessionID, id, input)),
        ),
      )
    if (parts[1] === "job" && parts.length === 2 && request.method === "POST") {
      const input = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Design.Render)))
      const renderer = yield* DesignRenderer.Service
      return HttpServerResponse.jsonUnsafe(yield* renderer.start(sessionID, id, input))
    }
    if (parts[1] === "job" && parts[2] && parts[3] === "cancel" && parts.length === 4 && request.method === "POST") {
      const renderer = yield* DesignRenderer.Service
      return HttpServerResponse.jsonUnsafe(yield* renderer.cancel(sessionID, id, parts[2]))
    }
    if (parts[1] === "reopen" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(yield* store.reopen(sessionID, id))
    if (parts[1] === "refresh" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(yield* store.refresh(sessionID, id))
    if (parts[1] === "feedback" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Design.Feedback)),
          Effect.flatMap((input) => DesignFeedback.admit(sessionID, id, input)),
        ),
      )
    if (parts[1] === "approve" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Design.Approve)),
          Effect.flatMap((input) => DesignHandoff.approve(sessionID, id, input)),
        ),
      )
    return failure(404, "Not found")
  })
}

function html(content: string) {
  return HttpServerResponse.text(content, {
    contentType: "text/html",
    headers: { "cache-control": "no-store", "content-security-policy": pageCSP },
  })
}

function failure(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe(
    { code: status === 404 ? "not-found" : status === 400 ? "invalid" : "unavailable", message },
    { status },
  )
}

function errorResponse(error: unknown) {
  if (error instanceof Design.Error)
    return failure(
      error.code === "not-found" ? 404 : error.code === "invalid" ? 400 : error.code === "unavailable" ? 503 : 409,
      error.message,
    )
  if (
    error instanceof Permission.BlockedError ||
    error instanceof Permission.DeclinedError ||
    error instanceof Permission.CorrectedError
  )
    return failure(403, error.message)
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "SchemaError")
    return failure(400, String(error))
  return failure(500, error instanceof Error ? error.message : String(error))
}
