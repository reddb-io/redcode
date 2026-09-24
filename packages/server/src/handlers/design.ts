import path from "node:path"
import { stat } from "node:fs/promises"
import { Cause, DateTime, Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignBuild } from "@reddb-io/redcode-core/design/build"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignFeedback } from "@reddb-io/redcode-core/design/feedback"
import { DesignFeed } from "@reddb-io/redcode-core/design/feed"
import { DesignReviewPresence } from "@reddb-io/redcode-core/design/review-presence"
import { DesignConversations } from "@reddb-io/redcode-core/design/conversations"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionGoal } from "@reddb-io/redcode-core/session/goal"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { LocationMutation } from "@reddb-io/redcode-core/location-mutation"
import { Api } from "../api"
import { ServerAuth } from "../auth"

// Compiled redcode defines REDCODE_DESIGN_APP_ONLY, so its bundler drops the pages and what renders
// them: the design app serves the review and the presenter, and these routes send the browser there.
const pages = process.env.REDCODE_DESIGN_APP_ONLY === "1" ? undefined : () => import("./design-pages")

/** The same page on the design app, which reaches this server's `design.host` for the conversation. */
const redirect = Effect.fn(function* (
  request: HttpServerRequest.HttpServerRequest,
  sessionID: string,
  route: string,
  search: Record<string, string | undefined> = {},
) {
  // While the app downloads or starts, the browser waits on a page that follows it, not a connection error.
  const opened = yield* DesignApp.open({
    host: { url: `http://${request.headers.host ?? "127.0.0.1"}`, authorization: ServerAuth.header() },
    sessionID,
    route,
    search,
  })
  if ("redirect" in opened) return HttpServerResponse.redirect(opened.redirect)
  return HttpServerResponse.text(opened.html, {
    status: opened.status,
    contentType: "text/html",
    headers: opened.headers,
  })
})

const unavailable = () =>
  new Design.Error({ code: "unavailable", message: "The design app serves this page; open the review from redcode" })

// The standalone server runs conversations on SessionV2; an embedding process with another runtime
// provides its own `design.host` handler instead (see `baseHandlers`).
const feed = Effect.fn(function* (sessionID: SessionV2.ID, after: number | undefined) {
  const sessions = yield* SessionV2.Service
  const session = yield* sessions
    .get(sessionID)
    .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
  const now = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))
  const agent: Design.FeedEvent = { type: "agent", seq: 0, at: yield* now, agent: session.agent ?? "" }
  // Working state is the process-local execution set sampled twice a second; only changes are sent.
  const state = Stream.make(undefined).pipe(
    Stream.concat(Stream.tick("500 millis")),
    Stream.mapEffect(() => sessions.active),
    Stream.map((active) => (active.has(sessionID) ? ("working" as const) : ("idle" as const))),
    Stream.changes,
    Stream.mapEffect((state) => Effect.map(now, (at): Design.FeedEvent => ({ type: "state", seq: 0, at, state }))),
  )
  const durable = sessions.events({ sessionID, after }).pipe(
    Stream.orDie,
    Stream.mapAccum(() => DesignFeed.initial, DesignFeed.reduce),
  )
  // A subscriber is a connected review page; publishing does not open another tab while it lasts.
  return Stream.unwrap(
    Effect.as(
      DesignReviewPresence.hold(sessionID),
      Stream.make(agent).pipe(Stream.concat(Stream.merge(durable, state))),
    ),
  )
})

const approve = Effect.fn(function* (sessionID: SessionV2.ID, designID: Design.ID, input: Design.Approve) {
  const store = yield* DesignStore.Service
  yield* store.get(designID, sessionID)
  const session = yield* SessionV2.Service
  const result = yield* store.approve(designID, input.revision, input.variant)
  const goals = yield* SessionGoal.Service
  const goal = yield* goals
    .get(sessionID)
    .pipe(Effect.mapError((error) => new Design.Error({ code: "conflict", message: error.message })))
  if (goal?.stopAfter === "design" && (goal.status === "active" || goal.status === "waiting")) return result
  yield* session
    .switchAgent({ sessionID, agent: "plan" })
    .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
  return result
})

const review = (request: HttpServerRequest.HttpServerRequest, sessionID: SessionV2.ID) =>
  new URL(
    `/api/session/${encodeURIComponent(sessionID)}/design/review`,
    `http://${request.headers.host ?? "localhost"}`,
  ).toString()

export const DesignHostHandler = HttpApiBuilder.group(Api, "design.host", (handlers) =>
  handlers
    .handle("designHost.list", (ctx) => DesignConversations.list(ctx.query.directory))
    .handle("designHost.open", (ctx) =>
      Effect.succeed({
        url: review(ctx.request, ctx.params.sessionID),
        connected: DesignReviewPresence.shared.connected(ctx.params.sessionID),
      }),
    )
    .handle("designHost.launch", (ctx) =>
      Effect.sync(() => ({
        url: review(ctx.request, ctx.params.sessionID),
        ...DesignReviewPresence.shared.claim(ctx.params.sessionID, { explicit: ctx.payload.explicit === true }),
      })),
    )
    .handle("designHost.release", (ctx) =>
      Effect.sync(() => DesignReviewPresence.shared.release(ctx.params.sessionID, ctx.payload.token)),
    )
    .handle("designHost.feed", (ctx) => feed(ctx.params.sessionID, ctx.query.after))
    .handle("designHost.feedback", (ctx) =>
      DesignFeedback.admit(ctx.params.sessionID, ctx.params.designID, ctx.payload),
    )
    .handle("designHost.approve", (ctx) => approve(ctx.params.sessionID, ctx.params.designID, ctx.payload))
    .handle(
      "designHost.permission",
      Effect.fn(function* (ctx) {
        const sessions = yield* SessionV2.Service
        const permissions = yield* PermissionV2.Service
        const session = yield* sessions
          .get(ctx.params.sessionID)
          .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
        return yield* permissions
          .assert({
            action: ctx.payload.permission,
            resources: ctx.payload.patterns,
            save: ctx.payload.always ?? [],
            sessionID: ctx.params.sessionID,
            agent: session.agent,
            metadata: { ...ctx.payload.metadata, origin: "design.host" },
          })
          .pipe(
            Effect.as({ granted: true }),
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              return error instanceof PermissionV2.DeclinedError ||
                error instanceof PermissionV2.CorrectedError ||
                error instanceof PermissionV2.BlockedError
                ? Effect.succeed({ granted: false })
                : Effect.failCause(cause)
            }),
            Effect.mapError((error) => new Design.Error({ code: "unavailable", message: error.message })),
          )
      }),
    ),
)

export const DesignHandler = HttpApiBuilder.group(Api, "server.design", (handlers) => {
  const owned = Effect.fn(function* (params: { designID: Design.ID; sessionID: SessionV2.ID }) {
    const store = yield* DesignStore.Service
    yield* store.get(params.designID, params.sessionID)
    return store
  })
  const read = Effect.fn(function* (sessionID: SessionV2.ID) {
    const sessions = yield* SessionV2.Service
    const permissions = yield* PermissionV2.Service
    const mutation = yield* LocationMutation.Service
    const session = yield* sessions
      .get(sessionID)
      .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
    return (file: string, signal?: AbortSignal) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const target = yield* mutation.resolve({ path: file, kind: "file" })
          if (target.externalDirectory)
            yield* permissions.assert({
              ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
              sessionID,
              agent: session.agent,
              metadata: { origin: "design.publish" },
            })
          yield* permissions.assert({
            action: "read",
            resources: [target.resource],
            save: [target.resource],
            sessionID,
            agent: session.agent,
            metadata: { origin: "design.publish" },
          })
        }),
        { signal },
      )
  })
  // Running the project's PostCSS pipeline executes its configuration in this process, which a
  // read grant does not cover: a distinct permission names the files; a refusal builds without it.
  const tooling = Effect.fn(function* (sessionID: SessionV2.ID, designID: Design.ID) {
    const sessions = yield* SessionV2.Service
    const permissions = yield* PermissionV2.Service
    const mutation = yield* LocationMutation.Service
    const store = yield* DesignStore.Service
    const document = yield* store.get(designID)
    const files = yield* Effect.promise(() => DesignBuild.tooling(document))
    if (!files.length) return false
    const session = yield* sessions
      .get(sessionID)
      .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
    const resources = yield* Effect.forEach(files, (file) =>
      Effect.all({
        target: mutation.resolve({ path: file, kind: "directory" }),
        directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
      }).pipe(Effect.map(({ target, directory }) => (directory ? `${target.resource}/*` : target.resource))),
    ).pipe(Effect.orDie)
    return yield* Effect.gen(function* () {
      yield* permissions.assert({
        action: "project_tooling",
        resources,
        save: resources,
        sessionID,
        agent: session.agent,
        metadata: {
          origin: "design.publish",
          reason: `execute project tooling: ${files.map((file) => path.basename(file)).join(", ")} (runs in the redcode process)`,
        },
      })
      return true
    }).pipe(
      // Only a refusal (deny rule, rejected prompt or correction) builds without the pipeline;
      // a rejected prompt arrives as a defect. Anything else surfaces.
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause)
        return error instanceof PermissionV2.DeclinedError ||
          error instanceof PermissionV2.CorrectedError ||
          error instanceof PermissionV2.BlockedError
          ? Effect.succeed(false)
          : Effect.failCause(cause)
      }),
      Effect.mapError((error) => new Design.Error({ code: "unavailable", message: error.message })),
    )
  })
  return handlers
    .handleRaw(
      "design.whiteboard",
      Effect.fn(function* () {
        if (!pages) return yield* unavailable()
        const { DesignPages } = yield* Effect.promise(pages)
        const html = yield* Effect.tryPromise({
          try: DesignPages.whiteboard,
          catch: (error) => new Design.Error({ code: "unavailable", message: String(error) }),
        })
        return HttpServerResponse.text(html, {
          contentType: "text/html",
          headers: { "cache-control": "private, max-age=3600" },
        })
      }),
    )
    .handleRaw(
      "design.review",
      Effect.fn(function* (ctx) {
        if (!pages) return yield* redirect(ctx.request, ctx.params.sessionID, "/review")
        const { DesignPages } = yield* Effect.promise(pages)
        const store = yield* DesignStore.Service
        // The page offers the configured web breakpoints; without a readable config, the defaults.
        const breakpoints = (yield* store
          .configured(ctx.params.sessionID)
          .pipe(Effect.catch(() => Effect.succeed(undefined))))?.breakpoints
        return DesignPages.review(ctx.params.sessionID, breakpoints)
      }),
    )
    .handle("design.feed", (ctx) => feed(ctx.params.sessionID, ctx.query.after))
    .handle(
      "design.list",
      Effect.fn(function* (ctx) {
        const store = yield* DesignStore.Service
        return yield* store.list(ctx.params.sessionID)
      }),
    )
    .handle(
      "design.create",
      Effect.fn(function* (ctx) {
        const store = yield* DesignStore.Service
        const sessions = yield* SessionV2.Service
        const document = yield* store.create(ctx.params.sessionID, ctx.payload)
        yield* sessions
          .switchAgent({ sessionID: ctx.params.sessionID, agent: "design" })
          .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
        return document
      }),
    )
    .handle(
      "design.get",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.get(ctx.params.designID)
      }),
    )
    .handle(
      "design.update",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.update(ctx.params.designID, ctx.payload)
      }),
    )
    .handle(
      "design.revisions",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.revisions(ctx.params.designID)
      }),
    )
    .handleRaw(
      "design.preview",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        if (!pages) return yield* unavailable()
        const { DesignPages } = yield* Effect.promise(pages)
        const renderer = yield* DesignRenderer.Service
        const revision = yield* store.revision(ctx.params.designID, ctx.params.revisionID)
        const directory = yield* renderer.directory(revision)
        return yield* Effect.tryPromise({
          try: () => DesignPages.preview(revision, directory),
          catch: (error) => new Design.Error({ code: "invalid", message: String(error) }),
        })
      }),
    )
    .handleRaw(
      "design.present",
      Effect.fn(function* (ctx) {
        yield* owned(ctx.params)
        const view = ctx.query.view ?? "audience"
        if (!pages)
          return yield* redirect(ctx.request, ctx.params.sessionID, `/${ctx.params.designID}/present`, {
            view,
            revision: ctx.query.revision,
          })
        const { DesignPages } = yield* Effect.promise(pages)
        return DesignPages.present({
          endpoint: `/api/session/${encodeURIComponent(ctx.params.sessionID)}/design`,
          designID: ctx.params.designID,
          view,
          revision: ctx.query.revision,
        })
      }),
    )
    .handle(
      "design.publish",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.publish(
          ctx.params.designID,
          ctx.payload.name,
          yield* read(ctx.params.sessionID),
          yield* tooling(ctx.params.sessionID, ctx.params.designID),
        )
      }),
    )
    .handle(
      "design.restore",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.restore(
          ctx.params.designID,
          ctx.payload.revision,
          yield* read(ctx.params.sessionID),
          yield* tooling(ctx.params.sessionID, ctx.params.designID),
        )
      }),
    )
    .handle(
      "design.reopen",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.reopen(ctx.params.designID)
      }),
    )
    .handle(
      "design.refresh",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.refresh(ctx.params.designID)
      }),
    )
    .handle("design.feedback", (ctx) => DesignFeedback.admit(ctx.params.sessionID, ctx.params.designID, ctx.payload))
    .handle("design.approve", (ctx) => approve(ctx.params.sessionID, ctx.params.designID, ctx.payload))
    .handle(
      "design.approval",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.approval(ctx.params.designID, ctx.params.revisionID)
      }),
    )
    .handle(
      "design.assets",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.assets(ctx.params.designID)
      }),
    )
    .handle(
      "design.importAsset",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.importAsset(ctx.params.designID, ctx.payload)
      }),
    )
    .handle(
      "design.jobs",
      Effect.fn(function* (ctx) {
        yield* owned(ctx.params)
        const renderer = yield* DesignRenderer.Service
        return yield* renderer.jobs(ctx.params.designID)
      }),
    )
    .handle(
      "design.render",
      Effect.fn(function* (ctx) {
        yield* owned(ctx.params)
        const renderer = yield* DesignRenderer.Service
        return yield* renderer.start(ctx.params.designID, ctx.payload)
      }),
    )
    .handle(
      "design.cancel",
      Effect.fn(function* (ctx) {
        yield* owned(ctx.params)
        const renderer = yield* DesignRenderer.Service
        return yield* renderer.cancel(ctx.params.designID, ctx.params.jobID)
      }),
    )
    .handleRaw(
      "design.download",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        const job = (yield* store.jobs(ctx.params.designID)).find((job) => job.id === ctx.params.jobID)
        if (!job || job.status !== "completed" || !job.result)
          return yield* new Design.Error({ code: "not-found", message: "Completed export not found" })
        const bytes = yield* Effect.tryPromise({
          try: () => Bun.file(job.result!).bytes(),
          catch: () => new Design.Error({ code: "not-found", message: "Export file is unavailable" }),
        })
        // A verify report is read in the browser from the feed; other exports download.
        return HttpServerResponse.uint8Array(bytes, {
          contentType: Design.exportFile(job.input.format).mime,
          headers: {
            "content-disposition": `${job.input.format === "verify" ? "inline" : "attachment"}; filename="${job.id}.${Design.exportFile(job.input.format).extension}"`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
          },
        })
      }),
    )
    .handleRaw(
      "design.assetFile",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        const asset = yield* store.asset(ctx.params.designID, ctx.params.assetID)
        return HttpServerResponse.uint8Array(yield* store.readBlob(asset.hash), {
          contentType: asset.mime,
          headers: {
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "x-content-type-options": "nosniff",
          },
        })
      }),
    )
})
