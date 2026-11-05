import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, settleMs, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

test("reconnect snapshots do not restore waits that ended while hydration was in flight", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requested = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const sessionID = "ses_wait_reconnect"
  const wait = { id: "wait_1", kind: "model" as const, started: 123, target: "provider/model" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/api/session/active") {
        requested.resolve()
        return response.promise
      }
      if (new URL(request.url).pathname === "/api/project") return Response.json([])
      return Response.json({ location: { directory: "/project" }, data: [] })
    },
  })
  const setup = createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: (handler) => (listeners.add(handler), () => listeners.delete(handler)) },
    })
    return { data, dispose }
  })
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  try {
    emit({ id: "evt_connected_wait", type: "server.connected", created: 1, data: {} })
    await requested.promise
    emit({ id: "evt_wait_end", type: "session.wait.changed", created: 2, data: { sessionID, waits: [] } })
    response.resolve(Response.json({ data: { [sessionID]: { type: "running", waits: [wait] } } }))
    for (let attempt = 0; attempt < 100 && setup.data.session.status(sessionID) !== "running"; attempt++)
      await Bun.sleep(10)
    expect(setup.data.session.status(sessionID)).toBe("running")
    expect(setup.data.session.waits(sessionID)).toEqual([])
  } finally {
    setup.dispose()
  }
})

test("config reads and update refreshes are opt-in", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  let model = "provider/first"
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/location/bootstrap")
        return Response.json({ location, data: { models: [], providers: [], integrations: [] } })
      if (url.pathname === "/api/config") return Response.json([{ type: "document", info: { model } }])
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const event: OpenCodeEvent = { id: "evt_config", created: 1, type: "config.updated", location, data: {} }
  try {
    await setup.data.location.sync()
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(requests).not.toContain("/api/config")

    await setup.data.location.config.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(1)
    model = "provider/second"
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.location.config.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(2)
    expect(setup.data.location.config.list()).toEqual([{ type: "document", info: { model } }])
  } finally {
    setup.dispose()
  }
})

test("event refreshes report failures, remain retryable, and preserve explicit read errors", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const reported = Promise.withResolvers<unknown>()
  const errors: unknown[] = []
  const state = { offline: true, requests: 0 }
  const session: SessionInfo = {
    id: "ses_refresh_failure",
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0, idle: 2 },
    location: { directory: "/project" },
  }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      state.requests++
      if (state.offline) throw new TypeError("Failed to fetch")
      return Response.json({ data: { ...session, title: "Recovered" } })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      onError(error) {
        errors.push(error)
        reported.resolve(error)
      },
    }),
    dispose,
  }))
  const event: OpenCodeEvent = {
    id: "evt_refresh_failure",
    created: 2,
    type: "session.viewed",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: { sessionID: session.id, idle: 2 },
  }
  try {
    setup.data.session.remember(session)
    setup.data.session.invalidate(session.id)
    await expect(setup.data.session.sync(session.id)).rejects.toThrow("Transport")
    expect(errors).toEqual([])
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(String(await reported.promise)).toContain("Transport")
    expect(errors).toHaveLength(1)
    expect(setup.data.session.get(session.id)?.title).toBeUndefined()
    state.offline = false
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.session.sync(session.id)
    expect(setup.data.session.get(session.id)?.title).toBe("Recovered")
    expect(state.requests).toBe(3)
  } finally {
    setup.dispose()
  }
})

test.each(["reconnecting", "disposed"] as const)("background reads respect %s owners", async (mode) => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const pending = Promise.withResolvers<Response>()
  const errors: unknown[] = []
  const state = { requests: 0 }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: () => {
      state.requests++
      return pending.promise
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status: () => (mode === "reconnecting" ? "reconnecting" : "connected") },
      onError: (error) => errors.push(error),
    }),
    dispose,
  }))
  const event: OpenCodeEvent = {
    id: "evt_refresh_owner",
    type: "command.updated",
    location: { directory: "/project" },
    data: {},
  }
  listeners.forEach((listener) => listener({ name: event.type, details: event }))
  if (mode === "reconnecting") {
    expect(state.requests).toBe(0)
    setup.dispose()
    return
  }
  const joined = setup.data.location.command.sync()
  setup.dispose()
  pending.reject(new TypeError("Failed to fetch"))
  await expect(joined).rejects.toThrow("Transport")
  expect(state.requests).toBe(1)
  expect(errors).toEqual([])
})

test("a burst of mcp.status.changed events refetches the server list once it settles", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(new URL(request.url).pathname)
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  try {
    await setup.data.location.mcp.server.sync()
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(1)
    for (const server of ["a", "b", "c", "d", "e"]) {
      const event: OpenCodeEvent = {
        id: `evt_${server}`,
        created: 1,
        type: "mcp.status.changed",
        location,
        data: { server },
      }
      listeners.forEach((listener) => listener({ name: event.type, details: event }))
    }
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, settleMs * 2))
    expect(requests.filter((path) => path === "/api/mcp")).toHaveLength(2)
  } finally {
    setup.dispose()
  }
})

test("invalidations that land before a queued reload starts are absorbed by it", async () => {
  const pending: Array<PromiseWithResolvers<Response>> = []
  const location = { directory: "/project" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: () => {
      const deferred = Promise.withResolvers<Response>()
      pending.push(deferred)
      return deferred.promise
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    const first = setup.data.location.agent.sync()
    expect(pending).toHaveLength(1)
    setup.data.location.agent.invalidate()
    const second = setup.data.location.agent.sync()
    setup.data.location.agent.invalidate()
    const third = setup.data.location.agent.sync()
    setup.data.location.agent.invalidate()
    expect(pending).toHaveLength(1)
    pending[0].resolve(Response.json({ location, data: [] }))
    await first
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    pending[1].resolve(Response.json({ location, data: [{ name: "reviewer" }] }))
    await Promise.all([second, third])
    expect(pending).toHaveLength(2)
    await setup.data.location.agent.sync()
    expect(pending).toHaveLength(2)
  } finally {
    setup.dispose()
  }
})

test.each([true, false])("location sync %s explicit directory starts scoped reads safely", async (explicit) => {
  const info = Promise.withResolvers<Response>()
  const requests: string[] = []
  const modelDirectories: Array<string | null> = []
  const location = { directory: "/project" }
  const canonical = { directory: "/canonical" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location/bootstrap") modelDirectories.push(url.searchParams.get("location[directory]"))
      if (url.pathname === "/api/location") return info.promise
      if (url.pathname === "/api/location/bootstrap")
        return Response.json({ location, data: { models: [], providers: [], integrations: [] } })
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event: { on: () => () => {}, listen: () => () => {} } }),
    dispose,
  }))
  const sync = setup.data.location.sync(explicit ? location : undefined)
  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests.includes("/api/location/bootstrap")).toBe(explicit)
  } finally {
    info.resolve(Response.json(canonical))
    await sync
    setup.dispose()
  }
  expect(requests.filter((path) => path === "/api/location")).toHaveLength(1)
  expect(requests).toContain("/api/location/bootstrap")
  expect(modelDirectories).toEqual([explicit ? "/project" : "/canonical"])
})

test("catalog bootstrap falls back on older servers and MCP resources load only on demand", async () => {
  const requests: string[] = []
  const location = { directory: "/project" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : new Request(input, init).url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location/bootstrap") return new Response(null, { status: 404 })
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [{ server: "s", uri: "test://one" }], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    await setup.data.location.sync(location)
    expect(requests.filter((path) => path === "/api/location/bootstrap")).toHaveLength(1)
    for (const path of ["/api/model", "/api/provider", "/api/integration"]) expect(requests).toContain(path)
    expect(requests).not.toContain("/api/mcp/resource")
    expect(setup.data.location.mcp.resource.list(location)).toBeUndefined()
    await setup.data.location.mcp.resource.sync(location)
    expect(requests.filter((path) => path === "/api/mcp/resource")).toHaveLength(1)
    expect(setup.data.location.mcp.resource.list(location)).toEqual([{ server: "s", uri: "test://one" }])
  } finally {
    setup.dispose()
  }
})

test("catalog bootstrap shares one request and preserves updates arriving during the read", async () => {
  const pending = Promise.withResolvers<Response>()
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : new Request(input, init).url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/location/bootstrap") return pending.promise
      if (url.pathname === "/api/model")
        return Response.json({ location, data: [{ id: "new", providerID: "p", name: "New" }] })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  try {
    const loading = Promise.all([
      setup.data.location.catalog.sync(location),
      setup.data.location.catalog.sync(location),
      setup.data.location.sync(location),
    ])
    expect(requests.filter((path) => path === "/api/location/bootstrap")).toHaveLength(1)
    const event: OpenCodeEvent = { id: "evt_models", created: 1, type: "model.updated", location, data: {} }
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    pending.resolve(
      Response.json({
        location,
        data: { models: [{ id: "old", providerID: "p", name: "Old" }], providers: [], integrations: [] },
      }),
    )
    await loading
    await setup.data.location.model.sync(location)
    expect(setup.data.location.model.list(location)?.map((model) => model.id)).toEqual(["new"])
    expect(requests.filter((path) => path === "/api/model")).toHaveLength(1)
    expect(requests).not.toContain("/api/provider")
    expect(requests).not.toContain("/api/integration")
  } finally {
    setup.dispose()
  }
})

test("catalog bootstrap does not hide server errors behind compatibility fallback", async () => {
  const requests: string[] = []
  const location = { directory: "/project" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : new Request(input, init).url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location/bootstrap")
        return Response.json({ _tag: "UnknownError", message: "failure" }, { status: 500 })
      if (url.pathname === "/api/location") return Response.json(location)
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))
  try {
    await expect(setup.data.location.sync(location)).rejects.toThrow()
    expect(requests).not.toContain("/api/model")
    expect(requests).not.toContain("/api/provider")
    expect(requests).not.toContain("/api/integration")
  } finally {
    setup.dispose()
  }
})

test("MCP resource updates stay lazy until the inventory is observed", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const location = { directory: "/project" }
  let requests = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      requests++
      return Response.json({ location, data: { resources: [], templates: [] } })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const event: OpenCodeEvent = { id: "evt_resource", created: 1, type: "mcp.resources.changed", location, data: {} }
  try {
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(requests).toBe(0)
    expect(setup.data.location.mcp.resource.list(location)).toBeUndefined()
    await setup.data.location.mcp.resource.sync(location)
    expect(requests).toBe(1)
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.location.mcp.resource.sync(location)
    expect(requests).toBe(2)
  } finally {
    setup.dispose()
  }
})
