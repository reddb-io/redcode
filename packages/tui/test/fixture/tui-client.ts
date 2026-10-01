import { OpenCode, type OpenCodeEvent, type SessionInfo } from "@opencode/client"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/tui`

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has("content-type")) headers.set("content-type", "application/json")
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function createEventStream() {
  const encoder = new TextEncoder()
  const v2 = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const pending: Uint8Array[] = []
  const response = (
    controllers: Set<ReadableStreamDefaultController<Uint8Array>>,
    queued: Uint8Array[],
    initial?: unknown,
  ) => {
    let current: ReadableStreamDefaultController<Uint8Array> | undefined
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          current = controller
          controllers.add(controller)
          if (initial) controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`))
          for (const chunk of queued.splice(0)) controller.enqueue(chunk)
        },
        cancel() {
          if (current) controllers.delete(current)
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  }
  const send = (
    controllers: Set<ReadableStreamDefaultController<Uint8Array>>,
    queued: Uint8Array[],
    event: unknown,
  ) => {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    if (controllers.size === 0) {
      queued.push(chunk)
      return
    }
    for (const controller of controllers) controller.enqueue(chunk)
  }

  return {
    emit(event: OpenCodeEvent) {
      send(v2, pending, event)
    },
    v2() {
      return response(v2, pending, { id: "evt_connected", type: "server.connected", data: {} })
    },
    disconnect() {
      for (const controller of v2) controller.close()
      v2.clear()
    },
  }
}

export type FetchHandler = (url: URL, request: Request) => Response | undefined | Promise<Response | undefined>

export function createFetch(override?: FetchHandler, events?: ReturnType<typeof createEventStream>) {
  const session = [] as URL[]
  const sessions = new Map<string, SessionInfo>()
  async function fetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === "/session") session.push(url)
    const overridden = await override?.(url, request)
    if (overridden) return overridden
    if (url.pathname === "/api/event" && events) return events.v2()

    if (
      [
        "/agent",
        "/command",
        "/experimental/workspace",
        "/experimental/workspace/status",
        "/formatter",
        "/lsp",
      ].includes(url.pathname)
    )
      return json([])
    if (["/config", "/experimental/resource", "/mcp", "/provider/auth", "/session/status"].includes(url.pathname))
      return json({})
    if (url.pathname === "/config/providers") return json({ providers: {}, default: {} })
    if (url.pathname === "/experimental/console") return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
    if (url.pathname === "/experimental/capabilities") return json({ backgroundSubagents: true })
    if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree, directory })
    if (url.pathname === "/api/location")
      return json({ directory, project: { id: "proj_test", directory: worktree, canonical: worktree } })
    if (url.pathname === "/api/plugin")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/vcs")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: { branch: { current: "main", default: "main" } },
      })
    if (url.pathname === "/api/redskilled")
      return json({
        location: { directory },
        data: {
          lifecycle: "unavailable",
          consent: "unknown",
          scope: "project",
          native: true,
          error: "Worker fixture is unavailable",
        },
      })
    if (url.pathname === "/api/lsp") return json({ location: { directory }, data: [] })
    if (/^\/api\/session\/[^/]+\/diff$/.test(url.pathname)) return json({ data: [] })
    if (request.method === "GET" && /^\/api\/session\/[^/]+\/monitor$/.test(url.pathname)) return json({ data: [] })
    if (request.method === "GET" && /^\/api\/session\/[^/]+\/budget$/.test(url.pathname))
      return json({
        data: {
          limits: {},
          override: {},
          spent: { cost: 0, tokens: 0, unpriced: 0 },
          exceeded: false,
          unknown: false,
          reason: "",
        },
      })
    if (request.method === "GET" && /^\/api\/experimental\/session\/[^/]+\/goal$/.test(url.pathname))
      return json({ data: null })
    if (url.pathname === "/api/fs/list")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/project") return json([])
    if (url.pathname === "/api/worktree") {
      if (request.method === "GET") return json([{ directory: worktree }])
      if (request.method === "POST") return json({ directory: `${worktree}/created` })
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/worktree/refresh") return new Response(null, { status: 204 })
    if (url.pathname === "/api/shell")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/mcp")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/mcp/resource")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: { resources: [], templates: [] },
      })
    if (url.pathname === "/api/experimental/intelligence")
      return json({
        settings: { enabled: true, reasoning: "single", onboarding: "completed" },
        environment: "",
        evaluators: [],
        effective: { reasoning: "single", source: "config" },
      })
    if (url.pathname === "/api/experimental/intelligence/history") return json([])
    if (url.pathname === "/api/experimental/intelligence/artifacts") return json([])
    if (url.pathname === "/api/session" && request.method === "POST") {
      const input = (await request.json()) as Pick<SessionInfo, "id" | "title" | "agent" | "model" | "location">
      const created: SessionInfo = {
        ...input,
        projectID: "proj_test",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), updated: Date.now() },
      }
      sessions.set(created.id, created)
      return json({ data: created })
    }
    if (url.pathname === "/api/session")
      return json({
        data: [...sessions.values()].filter((item) => {
          const parent = url.searchParams.get("parentID")
          return !parent || parent === "null" ? !item.parentID : item.parentID === parent
        }),
        cursor: {},
      })
    const stored = /^\/api\/session\/([^/]+)(?:\/(message|inbox|permission|todo))?$/.exec(url.pathname)
    if (stored && sessions.has(stored[1])) {
      if (stored[2]) return json({ data: [], cursor: {} })
      return json({ data: sessions.get(stored[1]) })
    }
    if (url.pathname === "/api/config") return json([])
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (request.method === "POST" && /^\/api\/session\/[^/]+\/model$/.test(url.pathname))
      return new Response(null, { status: 204 })
    if (url.pathname === "/api/permission/request")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/form")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (/^\/api\/session\/[^/]+\/form$/.test(url.pathname)) return json({ data: [] })
    if (/^\/api\/experimental\/session\/[^/]+\/terminal$/.test(url.pathname)) return json({ data: [] })
    if (
      ["/api/agent", "/api/model", "/api/provider", "/api/integration", "/api/command", "/api/skill"].includes(
        url.pathname,
      )
    )
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/reference")
      return json({ location: { directory, project: { id: "proj_test", directory, canonical: directory } }, data: [] })
    if (url.pathname === "/api/websearch/provider") {
      return json({ location: { directory, project: { id: "proj_test", directory, canonical: directory } }, data: [] })
    }
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    if (url.pathname === "/api/experimental/migration/v1") return json({ status: "completed" })
    if (url.pathname === "/api/debug/guards") return json({ summary: [], recent: [] })
    if (url.pathname === "/api/system")
      return json({
        version: "0.0.0-test",
        runtime: "bun test",
        platform: "linux x64",
        pid: 1,
        started: 0,
        memory: 0,
        urls: [],
        paths: { config: "/c", data: "/d", state: "/s", cache: "/k", log: "/l", tmp: "/t" },
        database: { kind: "memory" },
      })
    throw new Error(`unexpected request: ${url.pathname}`)
  }
  fetch.preconnect = () => {}
  return { fetch, session }
}

export function createApi(fetch: typeof globalThis.fetch) {
  return OpenCode.make({ baseUrl: "http://test", fetch })
}
