import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignFeedback } from "@reddb-io/redcode-core/design/feedback"
import { DesignExport } from "@reddb-io/redcode-core/design/export"
import { DesignWhiteboard } from "@reddb-io/redcode-core/design/whiteboard"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionGoal } from "@reddb-io/redcode-core/session/goal"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { LocationMutation } from "@reddb-io/redcode-core/location-mutation"
import { Api } from "../api"
import { mountReview } from "@reddb-io/redcode-design/review"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { annotations } from "@reddb-io/redcode-design/annotations"

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
  return handlers
    .handleRaw(
      "design.whiteboard",
      Effect.fn(function* () {
        const html = yield* Effect.tryPromise({
          try: DesignWhiteboard.frame,
          catch: (error) => new Design.Error({ code: "unavailable", message: String(error) }),
        })
        return HttpServerResponse.text(html, {
          contentType: "text/html",
          headers: { "cache-control": "private, max-age=3600" },
        })
      }),
    )
    .handleRaw("design.review", (ctx) =>
      Effect.succeed(
        HttpServerResponse.text(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>(${mountReview.toString()})(document.getElementById("review"), ${JSON.stringify({ base: "", sessionID: ctx.params.sessionID, copy: reviewCopy }).replaceAll("<", "\\u003c")})</script></body></html>`,
          {
            contentType: "text/html",
            headers: {
              "cache-control": "no-store",
              "content-security-policy":
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:",
            },
          },
        ),
      ),
    )
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
        const renderer = yield* DesignRenderer.Service
        const revision = yield* store.revision(ctx.params.designID, ctx.params.revisionID)
        const directory = yield* renderer.directory(revision)
        const html = yield* Effect.tryPromise({
          try: () =>
            DesignExport.html(directory, revision.document.engine === "html" ? revision.document.entry : "index.html"),
          catch: (error) => new Design.Error({ code: "invalid", message: String(error) }),
        })
        return HttpServerResponse.text(
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${html}<script>(${annotations.toString()})()</script>`,
          { contentType: "text/html", headers: { "cache-control": "private, max-age=31536000, immutable" } },
        )
      }),
    )
    .handle(
      "design.publish",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.publish(ctx.params.designID, ctx.payload.name, yield* read(ctx.params.sessionID))
      }),
    )
    .handle(
      "design.restore",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        return yield* store.restore(ctx.params.designID, ctx.payload.revision, yield* read(ctx.params.sessionID))
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
    .handle(
      "design.approve",
      Effect.fn(function* (ctx) {
        const store = yield* owned(ctx.params)
        const session = yield* SessionV2.Service
        const result = yield* store.approve(ctx.params.designID, ctx.payload.revision, ctx.payload.variant)
        const goals = yield* SessionGoal.Service
        const goal = yield* goals
          .get(ctx.params.sessionID)
          .pipe(Effect.mapError((error) => new Design.Error({ code: "conflict", message: error.message })))
        if (goal?.stopAfter === "design" && (goal.status === "active" || goal.status === "waiting")) return result
        yield* session
          .switchAgent({ sessionID: ctx.params.sessionID, agent: "plan" })
          .pipe(Effect.mapError((error) => new Design.Error({ code: "not-found", message: error.message })))
        return result
      }),
    )
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
        return HttpServerResponse.uint8Array(bytes, {
          contentType: job.input.format === "gif" ? "image/gif" : "text/html",
          headers: {
            "content-disposition": `attachment; filename="${job.id}.${job.input.format === "gif" ? "gif" : "html"}"`,
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
