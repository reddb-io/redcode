export * as DesignAppServer from "./server.js"

import { Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { sql } from "drizzle-orm"
import { DesignApp } from "@opencode/core/design/app"
import type { DesignAppHost } from "@opencode/core/design/app-host"
import { Database } from "@opencode/core/database/database"
import { DesignRenderer } from "@opencode/core/design/renderer"
import { DesignRendererLocal } from "@opencode/core/design/renderer-local"
import { DesignVendor } from "@opencode/core/design/vendor"
import { createRoutes } from "@opencode/server/routes"

export interface Options {
  readonly host: string
  readonly token: string
  readonly state: string
  readonly register: boolean
  readonly hostname: string
  readonly port: number
  readonly idle: number
  readonly database: Database.Options
  readonly version: string
}

/** Design pages and render jobs run here; Session mutations stay with their owning server. */
export async function start(options: Options) {
  const scope = await Effect.runPromise(Scope.make())
  const routes = createRoutes(
    {
      app: { name: "redcode-design", version: options.version },
      password: options.token,
      database: options.database,
      fs: { filewatcher: false },
      models: { fetch: false },
    },
    () => [],
    [DesignRenderer.node.replace(DesignRendererLocal.node)],
    { v1Migration: false },
  ).pipe(Layer.provide(HttpServer.layerServices))
  // The route layer supplies request services through its dynamic Layer.flatMap.
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      routes as unknown as Layer.Layer<Layer.Success<typeof routes>, Layer.Error<typeof routes>>,
      scope,
    ),
  )
  const local = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const db = Context.get(context, Database.Service).db
  const hosts = new Map<string, DesignAppHost.Host>()
  const activity = { requests: 0, feeds: 0, last: Date.now() }
  const lifecycle = { closing: false }
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    async fetch(request) {
      activity.requests++
      activity.last = Date.now()
      const response = await dispatch(request, options, hosts, local, activity, () => {
        void close().then(() => process.exit(0))
      }).finally(() => {
        activity.requests--
        activity.last = Date.now()
      })
      return response
    },
  })
  const registration = options.register
    ? await DesignApp.register(
        {
          url: server.url.origin,
          pid: process.pid,
          version: options.version,
          database: DesignApp.databaseFingerprint(options.database),
        },
        DesignApp.paths(options.state).registration,
      )
    : undefined
  const close = async () => {
    if (lifecycle.closing) return
    lifecycle.closing = true
    clearInterval(idle)
    server.stop()
    if (registration) await DesignApp.unregister(registration.id, DesignApp.paths(options.state).registration)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  const idle = setInterval(() => {
    if (activity.requests || activity.feeds || Date.now() - activity.last < options.idle) return
    void Effect.runPromise(
      db.get<{ count: number }>(sql`
        SELECT COUNT(*) AS count FROM design_render_job
        WHERE json_extract(data, '$.status') IN ('queued', 'running')
      `),
    ).then((row) => {
      if ((row?.count ?? 0) > 0 || activity.requests || activity.feeds) return
      return close().then(() => process.exit(0))
    }).catch((error) => console.error("Unable to inspect Design jobs before idle shutdown", error))
  }, 30_000)
  idle.unref()
  return { url: server.url.origin, close }
}

async function dispatch(
  request: Request,
  options: Options,
  hosts: Map<string, DesignAppHost.Host>,
  local: (request: Request) => Promise<Response>,
  activity: { feeds: number; requests: number; last: number },
  shutdown: () => void,
) {
  const url = new URL(request.url)
  const bearer = request.headers.get("authorization") === `Bearer ${options.token}`
  if (url.pathname === "/app/health")
    return bearer
      ? Response.json({
          healthy: true,
          protocol: DesignApp.PROTOCOL,
          version: options.version,
          pid: process.pid,
          database: DesignApp.databaseFingerprint(options.database),
        })
      : new Response(null, { status: 401 })
  if (url.pathname === "/app/shutdown" && request.method === "POST") {
    if (!bearer) return new Response(null, { status: 401 })
    setTimeout(shutdown, 100).unref()
    return Response.json({ stopping: true })
  }
  if (url.pathname.startsWith("/app/vendor/") && request.method === "GET") {
    if (!bearer) return new Response(null, { status: 401 })
    const asset = DesignVendor.FILES[url.pathname.slice("/app/vendor/".length)]
    return asset ? new Response(asset.body, { headers: { "content-type": asset.mime } }) : new Response(null, { status: 404 })
  }
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts[0] !== "design" || parts[1] !== "session" || !parts[2])
    return new Response(null, { status: 404 })
  const sessionID = decodeURIComponent(parts[2])
  if (parts[3] === "attach" && parts.length === 4 && request.method === "POST") {
    if (!bearer) return new Response(null, { status: 401 })
    const host = URL.parse(request.headers.get(DesignApp.HOST_HEADER) ?? "")
    if (!host || (host.protocol !== "http:" && host.protocol !== "https:"))
      return new Response(null, { status: 400 })
    hosts.set(sessionID, {
      url: host.origin,
      authorization: request.headers.get(DesignApp.HOST_AUTHORIZATION_HEADER) ?? undefined,
    })
    return Response.json({ attached: true })
  }
  const proxied =
    (parts[3] === "feed" && request.method === "GET") ||
    (parts[3] === "review" && request.method === "GET") ||
    (request.method !== "GET" && parts[4] !== "job")
  if (proxied) {
    const cookie = request.headers.get("cookie")
      ?.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${DesignApp.COOKIE}=`))
      ?.slice(`${DesignApp.COOKIE}=`.length)
    if (!bearer && !DesignApp.verify(options.token, sessionID, url.searchParams.get("ticket") ?? cookie))
      return new Response(null, { status: 401 })
    if (request.method !== "GET") {
      const origin = request.headers.get("origin")
      if (origin && URL.parse(origin)?.host !== url.host) return new Response(null, { status: 403 })
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return new Response(null, { status: 403 })
    }
    const host = hosts.get(sessionID)
    // Redcode attaches the Session whenever its review page loads or the agent publishes, so this is transient.
    if (!host)
      return Response.json(
        {
          code: "unavailable",
          message:
            "The design app is re-attaching this Session; it does so automatically on the next review request. Nothing needs to restart.",
        },
        { status: 503 },
      )
    const headers = new Headers(request.headers)
    headers.delete("host")
    headers.delete("origin")
    headers.delete("cookie")
    headers.delete("authorization")
    headers.delete("connection")
    headers.set("accept-encoding", "identity")
    if (host.authorization) headers.set("authorization", host.authorization)
    const response = await fetch(new URL(url.pathname + url.search, host.url), {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      signal: request.signal,
    })
    const ticket = url.searchParams.get("ticket")
    if (parts[3] === "review" && ticket && DesignApp.verify(options.token, sessionID, ticket)) {
      const headers = new Headers(response.headers)
      headers.append(
        "set-cookie",
        `${DesignApp.COOKIE}=${DesignApp.ticket(options.token, sessionID, DesignApp.COOKIE_TTL)}; Path=/design/session/${encodeURIComponent(sessionID)}; HttpOnly; SameSite=Strict; Max-Age=${DesignApp.COOKIE_TTL / 1000}${url.protocol === "https:" ? "; Secure" : ""}`,
      )
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    if (parts[3] !== "feed" || !response.body) return response
    activity.feeds++
    const reader = response.body.getReader()
    const state = { active: true }
    const finish = () => {
      if (!state.active) return
      state.active = false
      activity.feeds--
      activity.last = Date.now()
    }
    return new Response(
      new ReadableStream({
        pull(controller) {
          return reader.read().then(
            (chunk) => {
              if (chunk.done) {
                finish()
                controller.close()
                return
              }
              controller.enqueue(chunk.value)
            },
            (error) => {
              finish()
              controller.error(error)
            },
          )
        },
        async cancel(reason) {
          finish()
          await reader.cancel(reason)
        },
      }),
      response,
    )
  }
  if (!bearer) return local(request)
  const headers = new Headers(request.headers)
  headers.set("authorization", `Basic ${Buffer.from(`opencode:${options.token}`).toString("base64")}`)
  return local(new Request(request, { headers }))
}
