export * as DesignBrowser from "./design-browser"

import { Design } from "@opencode/schema/design"
import type { Agent } from "@opencode/schema/agent"
import { App } from "@opencode/core/app"
import { DesignFeed } from "@opencode/core/design/feed"
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
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { Cause, Duration, Effect, Exit, Option, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { ServerAuth } from "./auth"
import { DesignAccess } from "./design-access"
import { DesignBrowserPermissions } from "./design-browser-permissions"
import { authorizedRequest } from "./middleware/authorization"

const previewCSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
const pageCSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:"
const DesignPermission = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("read"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tooling"), designID: Design.ID }),
])

export const routes = (hosts: () => ReadonlyArray<string>) => HttpRouter.use((router) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const auth = yield* ServerAuth.Config
    const app = yield* App.Metadata
    const appConnection = yield* DesignAppConnection.Service
    const secret = Option.getOrElse(auth.password, () => DesignAccess.embeddedSecret)
    const previews = new Map<string, "building" | "ready" | "failed">()

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
      if (parts[0] === "link" && parts.length === 1 && request.method === "GET") {
        if (!trusted) return failure(401, "Server authorization is required to create a review link")
        const configured = yield* Effect.gen(function* () {
          const store = yield* DesignStore.Service
          return yield* store.configured(sessionID)
        }).pipe(instances.provide(session))
        if (DesignAppMode.process(configured)) {
          const { DesignApp } = yield* Effect.promise(() => import("@opencode/core/design/app"))
          const link = yield* Effect.tryPromise({
            try: async () =>
              DesignApp.link(
                await appConnection.connect(configured?.app?.version),
                sessionID,
              ),
            catch: (error) =>
              new Design.Error({
                code: "unavailable",
                message: `The design app did not start: ${error instanceof Error ? error.message : String(error)}`,
              }),
          })
          return HttpServerResponse.jsonUnsafe({ url: link })
        }
        const link = new URL(`/design/session/${sessionID}/review`, url)
        link.searchParams.set("ticket", DesignAccess.ticket(secret, sessionID))
        return HttpServerResponse.jsonUnsafe({ url: link.toString() })
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
      const response = parts[0] === "permission" && parts.length === 1
        ? request.method === "POST"
          ? yield* authorize(request, sessionID, session.agent).pipe(instances.provide(session))
          : failure(405, "Design permission requests must use POST")
        : request.method === "GET"
          ? yield* read(url, sessionID, parts, sessions, app.version, previews).pipe(instances.provide(session))
          : yield* mutate(request, sessionID, parts, session.agent).pipe(instances.provide(session))
      if (!linked) return response
      return response.pipe(
        HttpServerResponse.setCookieUnsafe(DesignAccess.COOKIE, DesignAccess.ticket(secret, sessionID, DesignAccess.COOKIE_TTL), {
          path: `/design/session/${sessionID}`,
          httpOnly: true,
          sameSite: "strict",
          secure: url.protocol === "https:",
          maxAge: Duration.millis(DesignAccess.COOKIE_TTL),
        }),
      )
    }).pipe(
      Effect.catchCause((cause) => Effect.succeed(errorResponse(Cause.squash(cause)))),
    )

    yield* router.add("*", "/design/session/:sessionID/*", handle)
  }),
)

function authorize(request: HttpServerRequest.HttpServerRequest, sessionID: SessionSchema.ID, agent: Agent.ID | undefined) {
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
  version: string,
  previews: Map<string, "building" | "ready" | "failed">,
) {
  return Effect.gen(function* () {
    const store = yield* DesignStore.Service
    const endpoint = `/design/session/${sessionID}`
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
        Stream.concat(DesignFeed.follow(sessions, sessionID, cursor).pipe(Stream.orDie)),
        Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`),
      )
      const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
      return HttpServerResponse.stream(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText), {
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
        Effect.onExit((exit) => Effect.sync(() => {
          previews.set(key, Exit.isSuccess(exit) ? "ready" : "failed")
        })),
      )
      return HttpServerResponse.text(content, {
        contentType: "text/html",
        headers: {
          "cache-control": "private, max-age=31536000, immutable",
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
        yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Design.Create)), Effect.flatMap((input) => store.create(sessionID, input))),
      )
    const id = Option.getOrUndefined(Schema.decodeUnknownOption(Design.ID)(parts[0]))
    if (!id) return failure(400, "Invalid design")
    const document = yield* store.get(sessionID, id)
    if (parts.length === 1 && request.method === "PATCH")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Design.Update)), Effect.flatMap((input) => store.update(sessionID, id, input))),
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
      return HttpServerResponse.jsonUnsafe(yield* store.restore(sessionID, id, input.revision, grants.read, grants.tooling))
    }
    if (parts[1] === "asset" && parts.length === 2 && request.method === "POST")
      return HttpServerResponse.jsonUnsafe(
        yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Design.ImportAsset)), Effect.flatMap((input) => store.importAsset(sessionID, id, input))),
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
