export * as DesignAppServer from "./server"

import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope } from "effect"
import { eq } from "drizzle-orm"
import { appearance } from "@reddb-io/redcode-design/brand.gen"
import { params } from "@reddb-io/redcode-design/params"
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
import { DesignVendor } from "@reddb-io/redcode-design/vendor"
import { Design } from "@reddb-io/redcode-schema/design"
import { Session } from "@reddb-io/redcode-schema/session"
import { AbsolutePath } from "@reddb-io/redcode-schema/schema"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Location } from "@reddb-io/redcode-core/location"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { DesignHost } from "@reddb-io/redcode-core/design/host"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignRendererLocal } from "@reddb-io/redcode-core/design/renderer-local"
import { DesignExport } from "@reddb-io/redcode-core/design/export"
import { DesignWhiteboard } from "@reddb-io/redcode-core/design/whiteboard"
import { InstallationVersion } from "@reddb-io/redcode-core/installation/version"
import { ServerAuth } from "@reddb-io/redcode-server/auth"
import { DesignAppHost } from "./host"

export interface Options {
  readonly hostname: string
  readonly port: number
  /** The redcode that started the app: `design.host` for sessions no other redcode claimed. */
  readonly host: string
  readonly token: string
  readonly register: boolean
  readonly state: string
  /** Milliseconds without review tabs, requests or running jobs before the app exits. */
  readonly idle: number
}

type Studio = Context.Context<DesignStore.Service | DesignRenderer.Service>

const PAGE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; connect-src 'self' data:; worker-src blob:"

/**
 * The design app's HTTP surface: the review page, presenter, whiteboard and previews under
 * `/design/session/:sessionID`, with the same routes the review page used inside redcode, and every
 * build, render and export behind them. The conversation stays in redcode, reached through `design.host`.
 * Callers holding the token (redcode) send it as a bearer; browser windows carry a signed ticket, from
 * the link redcode handed out, exchanged for a cookie scoped to that session.
 */
export async function start(options: Options) {
  const runtime = ManagedRuntime.make(AppNodeBuilder.build(Database.node))
  const scope = await runtime.runPromise(Scope.make())
  const files = DesignApp.paths(options.state)
  const hosts = new Map<string, DesignAppHost.Host>()
  const studios = new Map<string, Promise<Studio>>()
  const jobs = new Map<string, { readonly studio: Promise<Studio>; readonly designID: Design.ID }>()
  const activity = { tabs: 0, requests: 0, last: Date.now() }
  const fallback: DesignAppHost.Host = { url: options.host, authorization: ServerAuth.header() }

  const run = async <A>(effect: Effect.Effect<A, unknown, Database.Service>) => {
    const exit = await runtime.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  }

  const session = (sessionID: Session.ID) =>
    run(
      Effect.gen(function* () {
        const database = yield* Database.Service
        return yield* database.db
          .select({
            directory: SessionTable.directory,
            project: SessionTable.project_id,
            worktree: ProjectTable.worktree,
          })
          .from(SessionTable)
          .innerJoin(ProjectTable, eq(ProjectTable.id, SessionTable.project_id))
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
      }),
    )

  /** One store and renderer per directory, as redcode keeps one per instance: jobs and builds live here. */
  const studio = (row: { directory: string; project: Location.Info["project"]["id"]; worktree: string }) => {
    const existing = studios.get(row.directory)
    if (existing) return existing
    const built = run(
      Effect.gen(function* () {
        const database = yield* Database.Service
        return yield* Layer.buildWithScope(
          AppNodeBuilder.build(LayerNode.group([DesignStore.node, DesignRendererLocal.node]), [
            [Database.node, Layer.succeed(Database.Service, database)],
            [
              Location.node,
              Layer.succeed(Location.Service, {
                directory: AbsolutePath.make(row.directory),
                project: { id: row.project, directory: AbsolutePath.make(row.worktree) },
              }),
            ],
          ]),
          scope,
        )
      }),
    )
    studios.set(row.directory, built)
    built.catch(() => studios.delete(row.directory))
    return built
  }

  const serve = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (!DesignHost.allowed(request.headers.get("host") ?? undefined))
      return failure(403, "Design is not served under this host name")
    const trusted = request.headers.get("authorization") === `Bearer ${options.token}`
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] === "app") return control(request, parts, trusted)
    if (parts[0] !== "design" || parts[1] !== "session") return failure(404, "Not found")
    const sessionID = Option.getOrUndefined(Schema.decodeUnknownOption(Session.ID)(parts[2]))
    if (!sessionID) return failure(400, "Invalid session")
    const ticket = url.searchParams.get("ticket") ?? undefined
    const linked = !trusted && DesignApp.verify(options.token, sessionID, ticket)
    if (!trusted && !linked && !DesignApp.verify(options.token, sessionID, cookie(request, DesignApp.COOKIE)))
      return failure(401, "This review link expired or belongs to another session; open the review again from redcode")
    if (request.method !== "GET" && !trusted) {
      const origin = request.headers.get("origin")
      if (origin && (!URL.canParse(origin) || new URL(origin).host !== request.headers.get("host")))
        return failure(403, "Design refuses cross-origin writes")
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return failure(403, "Design writes must be JSON")
    }
    const hostURL = request.headers.get(DesignApp.HOST_HEADER)
    if (trusted && hostURL)
      hosts.set(sessionID, {
        url: hostURL,
        authorization: request.headers.get(DesignApp.HOST_AUTHORIZATION_HEADER) ?? undefined,
      })
    const response = await design(request, url, parts, sessionID, trusted).catch(error)
    // The link's ticket becomes a cookie for this session's routes, so the page's own requests and
    // the windows it opens (the presenter) need nothing else.
    if (linked)
      response.headers.append(
        "set-cookie",
        `${DesignApp.COOKIE}=${DesignApp.ticket(options.token, sessionID, DesignApp.COOKIE_TTL)}; Path=/design/session/${sessionID}; HttpOnly; SameSite=Strict; Max-Age=${DesignApp.COOKIE_TTL / 1000}`,
      )
    return response
  }

  const control = async (request: Request, parts: string[], trusted: boolean) => {
    if (parts[1] === "health" && request.method === "GET")
      return Response.json({
        healthy: true,
        protocol: DesignApp.PROTOCOL,
        version: InstallationVersion,
        pid: process.pid,
      })
    if (!trusted) return failure(401, "The design app token is required")
    if (parts[1] === "shutdown" && request.method === "POST") {
      setTimeout(() => void shutdown(), 50)
      return new Response(null, { status: 202 })
    }
    // A pre-0.22 prototype's assets, which redcode copies into it when importing it.
    const asset =
      parts[1] === "vendor" && parts.length === 3 && request.method === "GET" ? DesignVendor.FILES[parts[2]] : undefined
    if (asset) return new Response(asset.body, { headers: { "content-type": asset.mime } })
    return failure(404, "Not found")
  }

  const design = async (
    request: Request,
    url: URL,
    parts: string[],
    sessionID: Session.ID,
    trusted: boolean,
  ): Promise<Response> => {
    const host = hosts.get(sessionID) ?? fallback
    const endpoint = `/design/session/${sessionID}`
    const method = request.method
    if (method === "GET" && parts[3] === "feed" && parts.length === 4) return feed(request, host, sessionID, url)
    if (method === "POST" && parts[3] === "attach" && parts.length === 4 && trusted)
      return new Response(null, { status: 204 })
    const row = await session(sessionID)
    if (!row) return failure(404, `Session not found: ${sessionID}`)
    const context = studio(row)
    const services = await context
    const store = Context.get(services, DesignStore.Service)
    const renderer = Context.get(services, DesignRenderer.Service)
    const exec = <A>(effect: Effect.Effect<A, unknown, never>) => run(effect)
    const body = <A>(schema: Schema.Codec<A, unknown, never, never>) =>
      request.json().then((value) => exec(Schema.decodeUnknownEffect(schema)(value)))

    if (method === "GET" && parts[3] === "review" && parts.length === 4) {
      const breakpoints = (await exec(store.configured(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))))
        ?.breakpoints
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"><style>html,body,#review{height:100%;margin:0}</style></head><body><div id="review"></div><script>(${mountReview.toString()})(document.getElementById("review"), Object.assign(${JSON.stringify({ base: "", endpoint, sessionID, copy: reviewCopy, appearance, breakpoints }).replaceAll("<", "\\u003c")}, { feed: ${designFeed.toString()}, viewports: ${viewports.toString()}, device: ${device.toString()}, stage: ${stage.toString()}, deck: ${deck.toString()} }))</script></body></html>`,
      )
    }
    if (method === "GET" && parts[3] === "whiteboard" && parts.length === 4) return html(await DesignWhiteboard.frame())
    if (!parts[3]) {
      if (method === "GET") return Response.json(await exec(store.list(sessionID)))
      if (method === "POST") return Response.json(await exec(store.create(sessionID, await body(Design.Create))))
    }
    const id = Option.getOrUndefined(Schema.decodeUnknownOption(Design.ID)(parts[3]))
    if (!id) return failure(400, "Invalid design")
    const document = await exec(store.get(id, sessionID))
    // Publishing builds the revision here. redcode's tool already asked the tooling permission in its
    // own tool call and says what was granted; a review page's request is asked through design.host.
    const building = async <A>(schema: Schema.Codec<A, unknown, never, never>) => {
      const payload: unknown = await request.json()
      const input = await exec(Schema.decodeUnknownEffect(schema)(payload))
      const tooling =
        trusted && typeof payload === "object" && payload !== null && "tooling" in payload
          ? payload.tooling === true
          : await DesignAppHost.tooling(host, sessionID, document)
      return { input, tooling, read: DesignAppHost.reader(host, sessionID, row.directory) }
    }
    if (!parts[4] && method === "GET") return Response.json(document)
    if (!parts[4] && method === "PATCH") return Response.json(await exec(store.update(id, await body(Design.Update))))
    if (parts[4] === "revision" && !parts[5] && method === "GET") return Response.json(await exec(store.revisions(id)))
    if (parts[4] === "revision" && !parts[5] && method === "POST") {
      const build = await building(Schema.Struct({ name: Schema.String }))
      return Response.json(await exec(store.publish(id, build.input.name, build.read, build.tooling)))
    }
    if (parts[4] === "restore" && method === "POST") {
      const build = await building(Schema.Struct({ revision: Schema.String }))
      return Response.json(await exec(store.restore(id, build.input.revision, build.read, build.tooling)))
    }
    if (parts[4] === "revision" && parts[6] === "preview" && method === "GET") {
      const revision = await exec(store.revision(id, parts[5]))
      const directory = await exec(renderer.directory(revision))
      const content = await DesignExport.html(
        directory,
        revision.document.engine === "html" ? revision.document.entry : "index.html",
      ).catch((cause: unknown) => {
        throw new Design.Error({ code: "invalid", message: cause instanceof Error ? cause.message : String(cause) })
      })
      return html(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">${revision.document.target === "presentation" ? `<script>(${slides.toString()})(${deck.toString()})</script>` : ""}<script>(${screens.toString()})()</script>${content}<script>(${params.toString()})(${JSON.stringify(revision.document.controls ?? []).replaceAll("<", "\\u003c")});(${annotations.toString()})()</script>`,
      )
    }
    if (parts[4] === "present" && !parts[5] && method === "GET") {
      const present = {
        endpoint,
        designID: id,
        view: url.searchParams.get("view") === "presenter" ? "presenter" : "audience",
        revision: url.searchParams.get("revision") ?? undefined,
        copy: reviewCopy,
      }
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reviewCopy.presentTitle} · Redcode</title><link rel="icon" type="image/svg+xml" href="${appearance.favicon}"></head><body><div id="present"></div><script>(${mountPresent.toString()})(document.getElementById("present"), Object.assign(${JSON.stringify(present).replaceAll("<", "\\u003c")}, { deck: ${deck.toString()}, stage: ${stage.toString()} }))</script></body></html>`,
      )
    }
    if (parts[4] === "asset" && !parts[5] && method === "GET") return Response.json(await exec(store.assets(id)))
    if (parts[4] === "asset" && !parts[5] && method === "POST")
      return Response.json(await exec(store.importAsset(id, await body(Design.ImportAsset))))
    if (parts[4] === "asset" && parts[5] && method === "GET") {
      const asset = await exec(store.asset(id, parts[5]))
      return new Response(await exec(store.readBlob(asset.hash)), {
        headers: {
          "content-type": asset.mime,
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "x-content-type-options": "nosniff",
        },
      })
    }
    if (parts[4] === "job" && !parts[5] && method === "GET") return Response.json(await exec(renderer.jobs(id)))
    if (parts[4] === "job" && !parts[5] && method === "POST") {
      const job = await exec(renderer.start(id, await body(Design.Render)))
      jobs.set(job.id, { studio: context, designID: id })
      return Response.json(job)
    }
    if (parts[4] === "job" && parts[5] && parts[6] === "cancel" && method === "POST")
      return Response.json(await exec(renderer.cancel(id, parts[5])))
    if (parts[4] === "job" && parts[5] && parts[6] === "file" && method === "GET") {
      const job = (await exec(renderer.jobs(id))).find((job) => job.id === parts[5])
      if (!job?.result || job.status !== "completed") return failure(404, "Completed export not found")
      // A verify report is read in the browser from the feed; other exports download.
      return new Response(Bun.file(job.result), {
        headers: {
          "content-type": Design.exportFile(job.input.format).mime,
          "content-disposition": `${job.input.format === "verify" ? "inline" : "attachment"}; filename="${job.id}.${Design.exportFile(job.input.format).extension}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        },
      })
    }
    if (parts[4] === "reopen" && method === "POST") return Response.json(await exec(store.reopen(id)))
    if (parts[4] === "refresh" && method === "POST") return Response.json(await exec(store.refresh(id)))
    if (parts[4] === "approval" && parts[5] && method === "GET")
      return Response.json(await exec(store.approval(id, parts[5])))
    // The conversation's side: redcode admits feedback and hands an approval off to the plan.
    if ((parts[4] === "feedback" || parts[4] === "approve") && !parts[5] && method === "POST")
      return relay(
        await DesignAppHost.request(host, sessionID, `/${id}/${parts[4]}`, {
          method: "POST",
          body: await request.text(),
        }),
      )
    return failure(404, "Not found")
  }

  /** The conversation feed, relayed from redcode; while it is open the review tab keeps the app alive. */
  const feed = async (request: Request, host: DesignAppHost.Host, sessionID: Session.ID, url: URL) => {
    const after = url.searchParams.get("after")
    const upstream = await DesignAppHost.request(
      host,
      sessionID,
      `/feed${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      {
        headers: { accept: "text/event-stream" },
        signal: request.signal,
      },
    )
    if (!upstream.ok || !upstream.body) return relay(upstream)
    activity.tabs++
    const stream = { open: true }
    const close = () => {
      if (!stream.open) return
      stream.open = false
      activity.tabs--
      activity.last = Date.now()
    }
    request.signal.addEventListener("abort", close)
    return new Response(upstream.body.pipeThrough(new TransformStream({ flush: close })), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      },
    })
  }

  /** Jobs this app started that have not finished; finished ones are forgotten. */
  const running = async () => {
    await Promise.all(
      [...jobs].map(async ([jobID, job]) => {
        const current = await job.studio
          .then((services) => run(Context.get(services, DesignRenderer.Service).jobs(job.designID)))
          .catch((): Design.Job[] => [])
        const found = current.find((item) => item.id === jobID)
        if (!found || (found.status !== "queued" && found.status !== "running")) jobs.delete(jobID)
      }),
    )
    return jobs.size
  }

  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    // Feeds stay open for as long as a review tab does.
    idleTimeout: 0,
    fetch: (request) => {
      activity.requests++
      return serve(request).finally(() => {
        activity.requests--
        activity.last = Date.now()
      })
    },
  })
  const url = `http://${options.hostname.includes(":") ? `[${options.hostname}]` : options.hostname}:${server.port}`
  const registered = options.register
    ? await DesignApp.register({ url, pid: process.pid }, files.registration)
    : undefined

  const state = { stopping: false }
  const shutdown = async () => {
    if (state.stopping) return
    state.stopping = true
    clearInterval(idle)
    clearInterval(watch)
    if (registered) await DesignApp.unregister(registered.id, files.registration).catch(() => undefined)
    await server.stop(true)
    await runtime.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
    await runtime.dispose()
    process.exit(0)
  }
  const idle = setInterval(
    async () => {
      if (state.stopping || activity.tabs > 0 || activity.requests > 0) return
      if (Date.now() - activity.last < options.idle) return
      if (await running()) return
      await shutdown()
    },
    Math.max(250, Math.min(options.idle / 4, 30_000)),
  )
  // Another app took over the registration (a newer protocol, or a race lost): this one goes.
  const watch = setInterval(async () => {
    if (!registered || state.stopping) return
    if ((await DesignApp.registration(files.registration))?.id !== registered.id) await shutdown()
  }, 10_000)
  process.on("SIGTERM", () => void shutdown())
  process.on("SIGINT", () => void shutdown())
  return { url, stop: shutdown }
}

function failure(status: number, message: string) {
  return Response.json(
    { code: status === 404 ? "not-found" : status === 400 ? "invalid" : "unavailable", message },
    { status },
  )
}

function error(cause: unknown) {
  if (cause instanceof Design.Error)
    return Response.json(
      { code: cause.code, message: cause.message },
      { status: cause.code === "not-found" ? 404 : 409 },
    )
  if (typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "SchemaError")
    return failure(400, String(cause))
  if (cause instanceof SyntaxError) return failure(400, cause.message)
  return failure(500, cause instanceof Error ? cause.message : String(cause))
}

/** A `design.host` answer passed through as it came. */
async function relay(response: Response) {
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  })
}

function html(text: string) {
  return new Response(text, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": PAGE_CSP,
    },
  })
}

function cookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
