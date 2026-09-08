import { DesignReviewServer } from "@/design/review-server"
import { DesignHost } from "@/design/host"
import { DesignFeedback } from "@/design/feedback"
import { DesignRead } from "@/design/read"
import { DesignHandoff } from "@/design/handoff"
import { Effect, Schema, FileSystem } from "effect"
import { and, eq, isNotNull, isNull, or } from "drizzle-orm"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignTable } from "@reddb-io/redcode-core/design/sql"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignExport } from "@reddb-io/redcode-core/design/export"
import { DesignWhiteboard } from "@reddb-io/redcode-core/design/whiteboard"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { DesignStudio } from "@/design/studio"
import { InstanceStore } from "@/project/instance-store"
import { WorkspaceRef } from "@/effect/instance-ref"
import { SessionID } from "@/session/schema"
import { mountReview } from "@reddb-io/redcode-design/review"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { annotations } from "@reddb-io/redcode-design/annotations"

/** Browser JSON API shared with the review UI. Session admission remains owned by the TUI runtime. */
export function serveDesignEffect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    if (!DesignHost.allowed(request.headers.host)) return HttpServerResponse.empty({ status: 403 })
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] !== "design") return HttpServerResponse.empty({ status: 404 })
    const db = yield* Database.Service
    if (request.method === "GET" && parts[1] === "list" && parts.length === 2) {
      const directory = url.searchParams.get("directory")
      if (!directory) return HttpServerResponse.empty({ status: 400 })
      const rows = yield* db.db
        .select({
          sessionID: SessionTable.id,
          title: SessionTable.title,
          updated: SessionTable.time_updated,
          design: DesignTable.data,
        })
        .from(SessionTable)
        .leftJoin(
          DesignTable,
          and(eq(SessionTable.id, DesignTable.session_id), eq(DesignTable.directory, FSUtil.resolve(directory))),
        )
        .where(
          and(
            eq(SessionTable.directory, FSUtil.resolve(directory)),
            isNull(SessionTable.time_archived),
            or(isNotNull(DesignTable.id), eq(SessionTable.agent, "design")),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const conversations = rows.reduce((result, row) => {
        const current = result.get(row.sessionID)
        result.set(row.sessionID, {
          sessionID: row.sessionID,
          title: row.title,
          updated: Math.max(current?.updated ?? 0, row.updated, row.design?.updated ?? 0),
          designs: [
            ...(current?.designs ?? []),
            ...(row.design
              ? [
                  {
                    id: row.design.id,
                    name: row.design.name,
                    revision: row.design.revision,
                    approvedRevision: row.design.approvedRevision,
                    ended: row.design.ended,
                  },
                ]
              : []),
          ],
        })
        return result
      }, new Map<string, Design.Conversation>())
      return HttpServerResponse.jsonUnsafe([...conversations.values()].sort((a, b) => b.updated - a.updated))
    }
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
    const row = yield* db.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
    if (!row) return HttpServerResponse.empty({ status: 404 })
    const instances = yield* InstanceStore.Service
    return yield* instances.provide(
      { directory: row.directory },
      Effect.gen(function* () {
        const studio = yield* DesignStudio.Service
        yield* studio.assertSession(sessionID)
        if (request.method === "GET" && parts[3] === "open") {
          const review = yield* DesignReviewServer.Service
          return HttpServerResponse.jsonUnsafe({
            url: new URL(`/design/session/${sessionID}/review`, yield* review.url).toString(),
          })
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
            if (request.method === "GET" && parts[3] === "review")
              return html(
                `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>(${mountReview.toString()})(document.getElementById("review"), ${JSON.stringify({ base: "", endpoint: `/design/session/${sessionID}`, sessionID, copy: reviewCopy }).replaceAll("<", "\\u003c")})</script></body></html>`,
              )
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
              const content = yield* Effect.promise(() =>
                DesignExport.html(
                  directory,
                  revision.document.engine === "html" ? revision.document.entry : "index.html",
                ),
              )
              return html(
                `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${content}<script>(${annotations.toString()})()</script>`,
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
              return HttpServerResponse.uint8Array(yield* Effect.promise(() => Bun.file(job.result!).bytes()), {
                contentType: job.input.format === "gif" ? "image/gif" : "text/html",
                headers: {
                  "content-disposition": `attachment; filename="${job.id}.${job.input.format === "gif" ? "gif" : "html"}"`,
                  "x-content-type-options": "nosniff",
                  "content-security-policy": "default-src 'none'; sandbox",
                },
              })
            }
            if (parts[4] === "reopen" && request.method === "POST") return reply(yield* store.reopen(id))
            if (parts[4] === "refresh" && request.method === "POST") return reply(yield* store.refresh(id))
            // Publishing/restoring can read application dependencies: use TUI permissions, never a second permission queue.
            if ((parts[4] === "revision" || parts[4] === "restore") && request.method === "POST") {
              const { Permission } = yield* Effect.promise(() => import("@/permission"))
              const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
              const permissions = yield* Permission.Service
              const agents = yield* Agent.Service
              const session = yield* studio.assertSession(sessionID)
              const agent = yield* agents.get(session.agent ?? "design")
              const read = yield* DesignRead.make((input) =>
                permissions
                  .ask({
                    ...input,
                    sessionID,
                    ruleset: Permission.merge(agent!.permission, session.permission ?? []),
                  })
                  .pipe(Effect.orDie),
              )
              if (parts[4] === "revision")
                return reply(yield* store.publish(id, (yield* json(Schema.Struct({ name: Schema.String }))).name, read))
              return reply(
                yield* store.restore(id, (yield* json(Schema.Struct({ revision: Schema.String }))).revision, read),
              )
            }
            if (parts[4] === "approve" && request.method === "POST") {
              const approved = yield* DesignHandoff.approve(
                sessionID,
                id,
                (yield* json(Schema.Struct({ revision: Schema.String }))).revision,
              )
              if (approved.resume) {
                const feedback = yield* DesignFeedback.Service
                yield* feedback.resume(sessionID)
              }
              return reply(approved)
            }
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
