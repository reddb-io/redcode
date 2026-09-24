import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { Design } from "@reddb-io/redcode-schema/design"
import { AbsolutePath } from "@reddb-io/redcode-schema/schema"
import { Global } from "@reddb-io/redcode-core/global"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Location } from "@reddb-io/redcode-core/location"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignApp } from "@reddb-io/redcode-core/design/app"

// The design app runs from source in its own process, as redcode starts it in a checkout. A fake
// redcode stands in for `design.host`, recording what the app asks of the conversation.
const root = path.join(Global.Path.state, "design-app-test")
const directory = path.join(root, "project")
const states = {
  main: path.join(root, "main"),
  idle: path.join(root, "idle"),
  protocol: path.join(root, "protocol"),
  stale: path.join(root, "stale"),
}
const sessionID = SessionV2.ID.make(`ses_${crypto.randomUUID()}`)
const recorded: { permission: string[]; feedback: unknown[]; feeds: number } = {
  permission: [],
  feedback: [],
  feeds: 0,
}
const started = new Set<number>()

const host = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean)
    if (parts.slice(0, 3).join("/") !== "api/design/session") return new Response(null, { status: 404 })
    if (parts[4] === "permission") {
      const body = (await request.json()) as { permission: string }
      recorded.permission.push(body.permission)
      return Response.json({ granted: true })
    }
    if (parts[5] === "feedback") {
      const body = (await request.json()) as { id: string }
      recorded.feedback.push(body)
      return Response.json({ id: body.id, status: "admitted" })
    }
    if (parts[4] === "feed") {
      recorded.feeds++
      const event = { type: "agent", seq: 0, at: Date.now(), agent: "design" }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    return new Response(null, { status: 404 })
  },
})
const hostURL = `http://127.0.0.1:${host.port}`

const runtime = ManagedRuntime.make(
  AppNodeBuilder.build(LayerNode.group([DesignStore.node, Database.node, Location.node]), [
    [
      Location.node,
      Layer.unwrap(
        Effect.promise(async () => {
          await mkdir(directory, { recursive: true })
          const real = AbsolutePath.make(await realpath(directory))
          return Layer.succeed(Location.Service, {
            directory: real,
            project: { id: Project.ID.global, directory: real },
          })
        }),
      ),
    ],
  ]),
)

const state: { document?: Design.Info; app?: { url: string; token: string } } = {}

beforeAll(async () => {
  state.document = await runtime.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const location = yield* Location.Service
      const store = yield* DesignStore.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "design-app",
          directory: location.directory,
          title: "design-app",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const document = yield* store.create(sessionID, { name: "Card", journey: "new", engine: "html", kind: "screen" })
      yield* Effect.promise(() =>
        writeFile(
          path.join(document.root, document.entry),
          "<!doctype html><html><body><main><h1>Card</h1><p>Exported by the design app.</p></main></body></html>",
        ),
      )
      return document
    }),
  )
})

afterAll(async () => {
  await Promise.all(
    Object.values(states).map(async (dir) => {
      const info = await DesignApp.registration(DesignApp.paths(dir).registration)
      if (info) await DesignApp.stop(info.url, await DesignApp.token(DesignApp.paths(dir).token))
    }),
  )
  await sleep(500)
  for (const pid of started) if (DesignApp.alive(pid)) process.kill(pid, "SIGKILL")
  host.stop(true)
  await runtime.dispose()
})

async function ensure(dir: string, idleMinutes?: number) {
  const app = await DesignApp.ensure({ host: hostURL, state: dir, idleMinutes, timeout: 60_000 })
  const info = await DesignApp.registration(DesignApp.paths(dir).registration)
  if (info) started.add(info.pid)
  return { ...app, info }
}

function call(route: string, init: RequestInit = {}) {
  const app = state.app!
  return fetch(new URL(`/design/session/${sessionID}${route}`, app.url), {
    ...init,
    headers: {
      authorization: `Bearer ${app.token}`,
      [DesignApp.HOST_HEADER]: hostURL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

test("starts from source, registers, and is reused through its registration", async () => {
  const first = await ensure(states.main)
  expect(first.info?.protocol).toBe(DesignApp.PROTOCOL)
  expect(DesignApp.alive(first.info!.pid)).toBe(true)
  expect(await DesignApp.health(first.url, first.token)).toMatchObject({ healthy: true, protocol: DesignApp.PROTOCOL })
  const second = await ensure(states.main)
  expect(second.url).toBe(first.url)
  expect(second.info?.id).toBe(first.info!.id)
  state.app = first
}, 90_000)

test("publishes and exports through HTTP, and the job is what the store reads", async () => {
  const document = state.document!
  const published = await call(`/${document.id}/revision`, {
    method: "POST",
    body: JSON.stringify({ name: "First", tooling: false }),
  })
  expect(published.status).toBe(200)
  const revision = (await published.json()) as Design.Revision
  const render = await call(`/${document.id}/job`, {
    method: "POST",
    body: JSON.stringify({ revision: revision.id, format: "html" }),
  })
  expect(render.status).toBe(200)
  const job = (await render.json()) as Design.Job
  const deadline = Date.now() + 100_000
  const finished = async (): Promise<Design.Job | undefined> => {
    const jobs = (await (await call(`/${document.id}/job`)).json()) as Design.Job[]
    const current = jobs.find((item) => item.id === job.id)
    if (current && current.status !== "queued" && current.status !== "running") return current
    if (Date.now() > deadline) return current
    await sleep(250)
    return finished()
  }
  const done = await finished()
  expect(done?.error ?? null).toBeNull()
  expect(done?.status).toBe("completed")
  // redcode reads the same database: the job the app ran is there, with its file.
  const stored = await runtime.runPromise(Effect.flatMap(DesignStore.Service, (store) => store.jobs(document.id)))
  const same = stored.find((item) => item.id === job.id)
  expect(same?.status).toBe("completed")
  expect(await Bun.file(same!.result!).text()).toContain("Exported by the design app.")
  const file = await call(`/${document.id}/job/${job.id}/file`)
  expect(file.status).toBe(200)
}, 150_000)

test("reports a preview's build stage, which the review page follows while it waits", async () => {
  const document = state.document!
  const published = await call(`/${document.id}/revision`, {
    method: "POST",
    body: JSON.stringify({ name: "Status", tooling: false }),
  })
  expect(published.status).toBe(200)
  const revision = (await published.json()) as Design.Revision
  const stage = async () =>
    ((await (await call(`/${document.id}/revision/${revision.id}/status`)).json()) as { stage: string }).stage
  // Nothing asked for its preview yet.
  expect(await stage()).toBe("queued")
  const preview = await call(`/${document.id}/revision/${revision.id}/preview`)
  expect(preview.status).toBe(200)
  expect(await preview.text()).toContain("Exported by the design app.")
  expect(await stage()).toBe("ready")
}, 60_000)

test("a review link lets a browser in, and feedback and the feed go through design.host", async () => {
  const app = state.app!
  const document = state.document!
  const review = new URL(`/design/session/${sessionID}/review`, app.url)
  expect((await fetch(review)).status).toBe(401)
  const other = new URL(review)
  other.searchParams.set("ticket", DesignApp.ticket(app.token, `ses_${crypto.randomUUID()}`))
  expect((await fetch(other)).status).toBe(401)
  const linked = new URL(review)
  linked.searchParams.set("ticket", DesignApp.ticket(app.token, sessionID))
  const page = await fetch(linked)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain(`/design/session/${sessionID}`)
  const cookie = page.headers.get("set-cookie")!.split(";")[0]
  expect(cookie.startsWith(`${DesignApp.COOKIE}=`)).toBe(true)

  const list = await fetch(new URL(`/design/session/${sessionID}`, app.url), { headers: { cookie } })
  expect(list.status).toBe(200)
  expect(((await list.json()) as Design.Info[]).map((item) => item.id)).toContain(document.id)

  const feedback = {
    id: `msg_${crypto.randomUUID()}`,
    revision: document.revision ?? "rev",
    text: "Make the title larger",
    items: [],
    assets: [],
    snapshot: "",
    delivery: "steer",
    end: false,
  }
  const origin = new URL(app.url).origin
  const refused = await fetch(new URL(`/design/session/${sessionID}/${document.id}/feedback`, app.url), {
    method: "POST",
    headers: { cookie, origin: "http://evil.example", "content-type": "application/json" },
    body: JSON.stringify(feedback),
  })
  expect(refused.status).toBe(403)
  const receipt = await fetch(new URL(`/design/session/${sessionID}/${document.id}/feedback`, app.url), {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify(feedback),
  })
  expect(receipt.status).toBe(200)
  expect(await receipt.json()).toEqual({ id: feedback.id, status: "admitted" })
  expect(recorded.feedback).toContainEqual(feedback)

  const controller = new AbortController()
  const feed = await fetch(new URL(`/design/session/${sessionID}/feed`, app.url), {
    headers: { cookie },
    signal: controller.signal,
  })
  expect(feed.status).toBe(200)
  const chunk = await feed.body!.getReader().read()
  expect(new TextDecoder().decode(chunk.value)).toContain('"agent":"design"')
  controller.abort()
  expect(recorded.feeds).toBeGreaterThan(0)
})

test("serves a legacy prototype's vendor assets to redcode, and only to redcode", async () => {
  const app = state.app!
  const asset = await fetch(new URL("/app/vendor/daisyui.css", app.url), {
    headers: { authorization: `Bearer ${app.token}` },
  })
  expect(asset.status).toBe(200)
  expect(asset.headers.get("content-type")).toContain("text/css")
  expect((await asset.text()).length).toBeGreaterThan(1000)
  const missing = await fetch(new URL("/app/vendor/unknown.js", app.url), {
    headers: { authorization: `Bearer ${app.token}` },
  })
  expect(missing.status).toBe(404)
  expect((await fetch(new URL("/app/vendor/daisyui.css", app.url))).status).toBe(401)
})

test("reports its version and protocol for redcode's download check", async () => {
  const entry = path.join(import.meta.dir, "../src/index.ts")
  const run = async (flag: string) => {
    const child = Bun.spawn([process.execPath, entry, flag], { stdout: "pipe", stderr: "pipe" })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(0)
    return output.trim()
  }
  expect(await run("--protocol")).toBe(String(DesignApp.PROTOCOL))
  expect(await run("--version")).toBe("local")
})

test("exits by itself once idle and removes its registration", async () => {
  const app = await ensure(states.idle, 0.02)
  const deadline = Date.now() + 20_000
  while (DesignApp.alive(app.info!.pid) && Date.now() < deadline) await sleep(200)
  expect(DesignApp.alive(app.info!.pid)).toBe(false)
  expect(await DesignApp.registration(DesignApp.paths(states.idle).registration)).toBeUndefined()
}, 90_000)

test("refuses an app of another protocol and starts a new one", async () => {
  const stopped: string[] = []
  const old = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const route = new URL(request.url).pathname
      if (route === "/app/shutdown") stopped.push(route)
      if (route === "/app/health")
        return Response.json({ healthy: true, protocol: DesignApp.PROTOCOL + 1, version: "old", pid: process.pid })
      return new Response(null, { status: 202 })
    },
  })
  const url = `http://127.0.0.1:${old.port}`
  await mkdir(states.protocol, { recursive: true })
  await writeFile(
    DesignApp.paths(states.protocol).registration,
    JSON.stringify({ id: "old", url, pid: process.pid, version: "old", protocol: DesignApp.PROTOCOL + 1 }),
  )
  const app = await ensure(states.protocol)
  old.stop(true)
  expect(stopped).toContain("/app/shutdown")
  expect(app.url).not.toBe(url)
  expect(app.info?.protocol).toBe(DesignApp.PROTOCOL)
  expect(app.info?.pid).not.toBe(process.pid)
}, 90_000)

test("ignores a registration whose process is gone", async () => {
  const gone = Bun.spawn([process.execPath, "-e", ""])
  await gone.exited
  // It would even answer: only the dead pid tells the registration is stale.
  const answering = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ healthy: true, protocol: DesignApp.PROTOCOL, version: "old", pid: gone.pid }),
  })
  const url = `http://127.0.0.1:${answering.port}`
  await mkdir(states.stale, { recursive: true })
  await writeFile(
    DesignApp.paths(states.stale).registration,
    JSON.stringify({ id: "stale", url, pid: gone.pid, version: "old", protocol: DesignApp.PROTOCOL }),
  )
  const app = await ensure(states.stale)
  answering.stop(true)
  expect(app.url).not.toBe(url)
  expect(app.info?.pid).not.toBe(gone.pid)
  expect(DesignApp.alive(app.info!.pid)).toBe(true)
}, 90_000)
