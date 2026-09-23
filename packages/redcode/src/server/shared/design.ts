import type { Tool } from "@/tool/tool"
import { appearance } from "@reddb-io/redcode-design/brand.gen"
import { params } from "@reddb-io/redcode-design/params"
import { DesignHost } from "@/design/host"
import { DesignFeedback } from "@/design/feedback"
import { DesignConversation } from "@/design/conversation"
import { eq } from "drizzle-orm"
import { DesignRead } from "@/design/read"
import { Effect, Schema, FileSystem } from "effect"
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignExport } from "@reddb-io/redcode-core/design/export"
import { DesignWhiteboard } from "@reddb-io/redcode-core/design/whiteboard"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { DesignStudio } from "@/design/studio"
import { InstanceStore } from "@/project/instance-store"
import { WorkspaceRef } from "@/effect/instance-ref"
import { SessionID } from "@/session/schema"
import { NonNegativeInt } from "@reddb-io/redcode-schema/schema"
import { mountReview } from "@reddb-io/redcode-design/review"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { annotations } from "@reddb-io/redcode-design/annotations"
import { viewports } from "@reddb-io/redcode-design/viewports"
import { device } from "@reddb-io/redcode-design/devices"
import { stage } from "@reddb-io/redcode-design/stage"
import { screens } from "@reddb-io/redcode-design/screens"
import { deck, slides } from "@reddb-io/redcode-design/slides"
import { mountPresent } from "@reddb-io/redcode-design/present"
import { designFeed } from "@reddb-io/redcode-design/feed"

/**
 * The review page's document routes for conversations on the legacy loop. The session side (list, launches,
 * feed, feedback, approval, permissions) is the `design.host` contract; the page still reaches its feed,
 * feedback and approval here, through the same implementation.
 */
export function serveDesignEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    if (!DesignHost.allowed(request.headers.host)) return HttpServerResponse.empty({ status: 403 })
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] !== "design") return HttpServerResponse.empty({ status: 404 })
    if (parts[1] !== "session") return HttpServerResponse.empty({ status: 404 })
    const sessionID = yield* Schema.decodeUnknownEffect(SessionID)(parts[2])
    if (request.method !== "GET") {
      const origin = request.headers.origin
      if (
        (origin && (!URL.canParse(origin) || new URL(origin).host !== request.headers.host)) ||
        !request.headers["content-type"]?.startsWith("application/json")
      )
        return HttpServerResponse.empty({ status: 403 })
    }
    const db = yield* Database.Service
    const row = yield* db.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
    if (!row) return HttpServerResponse.empty({ status: 404 })
    const instances = yield* InstanceStore.Service
    return yield* instances.provide(
      { directory: row.directory },
      Effect.gen(function* () {
        const studio = yield* DesignStudio.Service
        yield* studio.assertSession(sessionID)
        if (request.method === "GET" && parts[3] === "feed" && parts.length === 4) {
          // `after` is accepted for parity with the V2 route but not applied: see DesignConversation.feed.
          yield* Schema.decodeUnknownEffect(Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt)))(
            url.searchParams.get("after") ?? "0",
          )
          return yield* DesignConversation.feed(sessionID)
        }
        return yield* studio.use(
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            const renderer = yield* DesignRenderer.Service
            const json = <A>(schema: Schema.Codec<A, unknown, never, never>) =>
              request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
            const reply = HttpServerResponse.jsonUnsafe
            const html = (text: string) =>
              HttpServerResponse.text(text, {
                contentType: "text/html",
                headers: {
                  "cache-control": "no-store",
                  "content-security-policy":
                    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:",
                },
              })
            if (request.method === "GET" && parts[3] === "review") {
              const breakpoints = (yield* store.configured(sessionID))?.breakpoints
              return html(
                `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>(${mountReview.toString()})(document.getElementById("review"), Object.assign(${JSON.stringify({ base: "", endpoint: `/design/session/${sessionID}`, sessionID, copy: reviewCopy, appearance, breakpoints }).replaceAll("<", "\\u003c")}, { feed: ${designFeed.toString()}, viewports: ${viewports.toString()}, device: ${device.toString()}, stage: ${stage.toString()}, deck: ${deck.toString()} }))</script></body></html>`,
              )
            }
            if (request.method === "GET" && parts[3] === "whiteboard")
              return html(yield* Effect.promise(DesignWhiteboard.frame))
            if (!parts[3]) {
              if (request.method === "GET") return reply(yield* store.list(sessionID))
              if (request.method === "POST") return reply(yield* store.create(sessionID, yield* json(Design.Create)))
            }
            const id = yield* Schema.decodeUnknownEffect(Design.ID)(parts[3])
            yield* store.get(id, sessionID)
            if (!parts[4] && request.method === "GET") return reply(yield* store.get(id))
            if (!parts[4] && request.method === "PATCH")
              return reply(yield* store.update(id, yield* json(Design.Update)))
            if (parts[4] === "revision" && !parts[5] && request.method === "GET")
              return reply(yield* store.revisions(id))
            if (parts[4] === "asset" && request.method === "GET" && !parts[5]) return reply(yield* store.assets(id))
            if (parts[4] === "asset" && request.method === "POST")
              return reply(yield* store.importAsset(id, yield* json(Design.ImportAsset)))
            if (parts[4] === "asset" && request.method === "GET" && parts[5]) {
              const asset = yield* store.asset(id, parts[5])
              return HttpServerResponse.uint8Array(yield* store.readBlob(asset.hash), {
                contentType: asset.mime,
                headers: {
                  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                  "x-content-type-options": "nosniff",
                },
              })
            }
            if (parts[4] === "revision" && parts[6] === "preview" && request.method === "GET") {
              const revision = yield* store.revision(id, parts[5])
              const directory = yield* renderer.directory(revision)
              const content = yield* Effect.tryPromise({
                try: () =>
                  DesignExport.html(
                    directory,
                    revision.document.engine === "html" ? revision.document.entry : "index.html",
                  ),
                catch: (error) =>
                  new Design.Error({
                    code: "invalid",
                    message: error instanceof Error ? error.message : String(error),
                  }),
              })
              return html(
                `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${revision.document.target === "presentation" ? `<script>(${slides.toString()})(${deck.toString()})</script>` : ""}<script>(${screens.toString()})()</script>${content}<script>(${params.toString()})(${JSON.stringify(revision.document.controls ?? []).replaceAll("<", "\\u003c")});(${annotations.toString()})()</script>`,
              )
            }
            if (parts[4] === "present" && !parts[5] && request.method === "GET") {
              const view = url.searchParams.get("view") === "presenter" ? "presenter" : "audience"
              const options = {
                endpoint: `/design/session/${sessionID}`,
                designID: id,
                view,
                revision: url.searchParams.get("revision") ?? undefined,
                copy: reviewCopy,
              }
              return html(
                `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reviewCopy.presentTitle} · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"></head><body><div id="present"></div><script>(${mountPresent.toString()})(document.getElementById("present"), Object.assign(${JSON.stringify(options).replaceAll("<", "\\u003c")}, { deck: ${deck.toString()}, stage: ${stage.toString()} }))</script></body></html>`,
              )
            }
            if (parts[4] === "job" && request.method === "GET" && !parts[5]) return reply(yield* renderer.jobs(id))
            if (parts[4] === "job" && request.method === "POST")
              return reply(yield* renderer.start(id, yield* json(Design.Render)))
            if (parts[4] === "job" && parts[6] === "cancel" && request.method === "POST")
              return reply(yield* renderer.cancel(id, parts[5]))
            if (parts[4] === "job" && parts[6] === "file" && request.method === "GET") {
              const job = (yield* renderer.jobs(id)).find((job) => job.id === parts[5])
              if (!job?.result || job.status !== "completed") return HttpServerResponse.empty({ status: 404 })
              // A verify report is read in the browser from the feed; other exports download.
              return HttpServerResponse.uint8Array(yield* Effect.promise(() => Bun.file(job.result!).bytes()), {
                contentType: Design.exportFile(job.input.format).mime,
                headers: {
                  "content-disposition": `${job.input.format === "verify" ? "inline" : "attachment"}; filename="${job.id}.${Design.exportFile(job.input.format).extension}"`,
                  "x-content-type-options": "nosniff",
                  "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
                },
              })
            }
            if (parts[4] === "reopen" && request.method === "POST") return reply(yield* store.reopen(id))
            if (parts[4] === "refresh" && request.method === "POST") return reply(yield* store.refresh(id))
            // Publishing/restoring can read application dependencies: use TUI permissions, never a second permission queue.
            if ((parts[4] === "revision" || parts[4] === "restore") && request.method === "POST") {
              const permission = yield* DesignConversation.ask(sessionID)
              const ask = (input: Parameters<Tool.Context["ask"]>[0]) => permission(input).pipe(Effect.orDie)
              const read = yield* DesignRead.make(ask)
              const tooling = yield* DesignRead.tooling(yield* store.get(id, sessionID), ask)
              if (parts[4] === "revision")
                return reply(
                  yield* store.publish(id, (yield* json(Schema.Struct({ name: Schema.String }))).name, read, tooling),
                )
              return reply(
                yield* store.restore(
                  id,
                  (yield* json(Schema.Struct({ revision: Schema.String }))).revision,
                  read,
                  tooling,
                ),
              )
            }
            if (parts[4] === "approve" && request.method === "POST")
              return reply(yield* DesignConversation.approve(sessionID, id, yield* json(Design.Approve)))
            if (parts[4] === "approval" && parts[5] && request.method === "GET")
              return reply(yield* store.approval(id, parts[5]))
            if (parts[4] === "feedback" && request.method === "POST") {
              const feedback = yield* DesignFeedback.Service
              return reply(yield* feedback.admit(sessionID, id, yield* json(Design.Feedback)))
            }
            return HttpServerResponse.empty({ status: 404 })
          }),
        )
      }).pipe(Effect.provideService(WorkspaceRef, row.workspace_id ?? undefined)),
    )
  }).pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(24 * 1024 * 1024)),
    Effect.catchTag("Design.Error", (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({ message: error.message }, { status: error.code === "not-found" ? 404 : 409 }),
      ),
    ),
    Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
  )
}
