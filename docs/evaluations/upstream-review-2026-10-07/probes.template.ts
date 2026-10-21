import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createData, createClientConnection } from "@opencode/client/solid"
import { OpenCode, type OpenCodeEvent } from "@opencode/client"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { createSessionRetention } from "__REPO__/packages/tui/src/context/session-retention"
import { createApi, createFetch, createEventStream, directory, json } from "__REPO__/packages/tui/test/fixture/tui-client"
import { tmpdir } from "__REPO__/packages/tui/test/fixture/fixture"
import { start, append, finish } from "__REPO__/packages/ai/src/protocols/utils/tool-stream"
import { StreamableHTTPClientTransport } from "__REPO__/packages/core/node_modules/@modelcontextprotocol/client"

const record = (value: Record<string, unknown>) => console.log(`AUDIT ${JSON.stringify(value)}`)
const memory = () => ({ rssBytes: process.memoryUsage.rss(), heapUsedBytes: process.memoryUsage().heapUsed })
const quantile = (values: number[], fraction: number) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]

test("cancelled SDK request does not reach server after shared auth refresh", async () => {
  const state = { token: "expired", waiting: 0 }
  const release = Promise.withResolvers<void>()
  const executed: number[] = []
  const server = Bun.serve({ port: 0, async fetch(request) {
    const message = await request.json()
    if (request.headers.get("authorization") !== "Bearer fresh") return new Response("expired", { status: 401 })
    executed.push(message.id)
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
  } })
  const transport = new StreamableHTTPClientTransport(server.url, { authProvider: {
    token: async () => state.token,
    async onUnauthorized() { state.waiting++; await release.promise },
  } })
  const abort = new AbortController()
  await transport.start()
  const tasks = Promise.allSettled([
    transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fixture" } }, { requestSignal: abort.signal }),
    transport.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "fixture" } }),
  ])
  try {
    const deadline = Date.now() + 5000
    while (state.waiting < 2) {
      if (Date.now() >= deadline) throw new Error("refresh admission deadline")
      await Bun.sleep(5)
    }
    abort.abort()
    state.token = "fresh"
    release.resolve()
    const outcomes = await tasks
    record({ scenario: "sdk-cancel-refresh", executed, outcomes: outcomes.map((result) => result.status) })
    expect(executed).toEqual([2])
    expect(outcomes[0].status).toBe("rejected")
    expect(outcomes[1].status).toBe("fulfilled")
  } finally { release.resolve(); await transport.close(); await tasks; await server.stop() }
}, 10000)

test("observe malformed final tool arguments without executing a tool", async () => {
  for (const input of ['{"path":"/tmp/fixture', 'not-json']) {
    const state = start({}, 0, { id: "call_audit", name: "read", input })
    const result = await Effect.runPromise(finish("audit", state, 0))
    const call = result.events?.find((event) => event.type === "tool-call")
    record({ scenario: "malformed-tool-input", raw: input, emittedCall: call })
    expect(call?.type).toBe("tool-call")
  }
})

test("measure real partial argument parser across growing inputs", () => {
  for (const size of [5000, 50000, 200000]) {
    const input = JSON.stringify({ text: "x".repeat(size) })
    let state = start({}, 0, { id: "call_perf", name: "write" })
    const started = performance.now()
    for (let offset = 0; offset < input.length; offset += 100) {
      const result = append(state, 0, input.slice(offset, offset + 100))
      if (!result) throw new Error("missing accumulator")
      state = result.tools
    }
    record({ scenario: "partial-tool-parser", bytes: input.length, chunkBytes: 100, elapsedMs: performance.now() - started })
    expect(state[0]?.input).toBe(input)
  }
}, 60000)

function retainedData() {
  return createRoot((dispose) => {
    const events = createGlobalEmitter<{ [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }>()
    const api = createApi(createFetch((url) => {
      if (url.pathname.endsWith("/message") || url.pathname.endsWith("/inbox")) return json({ data: [], cursor: {} })
    }).fetch)
    const data = createData({ api: () => api, event: events, directory })
    const [current, setCurrent] = createSignal("current")
    const [keep, setKeep] = createSignal<string[]>([])
    const evictions: string[] = []
    createSessionRetention({ session: { ...data.session, evict(id) { evictions.push(id); data.session.evict(id) } }, current, keep, limit: 3 })
    const remember = (id: string, parentID?: string) => data.session.remember({
      id, parentID, projectID: "fixture", location: { directory }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 },
    })
    remember("current")
    remember("background")
    remember("child", "background")
    return { data, events, dispose, evictions, remember, setCurrent, setKeep }
  })
}

test.each([1000, 10000])("observe excluded and active cache after %s model steps", async (count) => {
  const scope = retainedData()
  try {
    const before = memory()
    const evictions = scope.evictions.length
    const started = performance.now()
    for (const sessionID of ["current", "background", "child"]) {
      for (let n = 0; n < count; n++) {
        scope.events.emit("session.step.started", {
          id: `evt_${sessionID}_${n}`, created: n, type: "session.step.started",
          durable: { aggregateID: sessionID, seq: n * 2 + 1, version: 1 },
          data: { sessionID, assistantMessageID: `msg_${sessionID}_${n}`, agent: "build", model: { providerID: "fixture", id: "fixture" }, started: n },
        })
        scope.events.emit("session.step.ended", {
          id: `evt_end_${sessionID}_${n}`, created: n + 1, type: "session.step.ended",
          durable: { aggregateID: sessionID, seq: n * 2 + 2, version: 1 },
          data: { sessionID, assistantMessageID: `msg_${sessionID}_${n}`, finish: "stop", cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        })
      }
    }
    await Promise.resolve()
    record({ scenario: "retention", count, before, after: memory(), eventProcessingMs: performance.now() - started,
      activeRows: scope.data.session.message.list("current").length,
      excludedRows: scope.data.session.message.list("background").length,
      excludedChildRows: scope.data.session.message.list("child").length,
      additionalEvictions: scope.evictions.length - evictions })
    // These assertions pin observed defects, not desired behavior or a fix.
    expect(scope.data.session.message.list("background")).toHaveLength(count)
    expect(scope.data.session.message.list("child")).toHaveLength(count)
    expect(scope.evictions.length).toBe(evictions)
    for (let n = 0; n < 100; n++) {
      const id = `visited_${n}`
      scope.remember(id)
      scope.setKeep([id])
      scope.setCurrent(id)
      await scope.data.session.message.sync(id)
      scope.setKeep([])
    }
    record({ scenario: "navigation-100", count, excludedRowsAfterNavigation: scope.data.session.message.list("background").length,
      explicitEvictions: scope.evictions.length, after: memory() })
    scope.setCurrent("background")
    await scope.data.session.message.sync("background")
    expect(scope.data.session.get("background")?.id).toBe("background")
  } finally { scope.dispose() }
}, 180000)

test("80 forced reconnects preserve bounded connection history and clean up", async () => {
  const events = createEventStream()
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: createFetch(undefined, events).fetch })
  const api = OpenCode.make({ baseUrl: server.url.toString() })
  let received = 0
  const scope = createRoot((dispose) => ({ dispose, connection: createClientConnection(api, { flushInterval: 0, onEvent: () => received++ }) }))
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) throw new Error("reconnect deadline")
      await Bun.sleep(5)
    }
  }
  try {
    await wait(() => received === 1)
    for (let n = 0; n < 80; n++) {
      scope.connection.internal.resync("audit forced reconnect")
      await wait(() => received === n + 2)
    }
    record({ scenario: "reconnect-80", received, historyLength: scope.connection.internal.history().length, status: scope.connection.status(), after: memory() })
    expect(scope.connection.internal.history()).toHaveLength(50)
    expect(scope.connection.status()).toBe("connected")
  } finally { scope.dispose(); events.disconnect(); await server.stop() }
}, 60000)

async function renderProbe(count: number, width: number, duration = 0) {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = { id: "ses_audit", title: "Audit", projectID: "proj_audit", location: { directory }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 } }
  const messages = Array.from({ length: count / 2 }, (_, n) => [
    { id: `user_${n}`, type: "user", text: `Prompt ${n}`, time: { created: n * 2 } },
    { id: `assistant_${n}`, type: "assistant", agent: "build", model: { providerID: "fixture", id: "fixture" }, finish: "stop",
      time: { created: n * 2 + 1, completed: n * 2 + 2 }, content: [{ type: "text", text: `Answer ${n}\n\n**Markdown** with a short code reference.` }] },
  ]).flat()
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    // Deliberately inject all rows: this measures loaded-history stress, not initial page size.
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: calls.fetch })
  let heartbeatSequence = 0
  const heartbeat = setInterval(() => events.emit({
    id: `evt_audit_heartbeat_${++heartbeatSequence}`, created: Date.now(), type: "session.usage.updated",
    durable: { aggregateID: session.id, seq: heartbeatSequence, version: 1 },
    data: { sessionID: session.id, cost: 0, tokens: session.tokens },
  }), 15000)
  const { run } = await import("__REPO__/packages/tui/src/app")
  const before = memory()
  const started = performance.now()
  const task = Effect.runPromise(run({
    app: { name: "audit", version: "audit", channel: "test" }, server: { endpoint: { url: server.url.toString() } },
    config: { get: async () => ({ animations: false, tabs: { enabled: false } }), update: async () => ({}) },
    packages: { prepare: async () => ({ directory: "" }) }, args: { sessionID: session.id },
    terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }), log: () => {},
  }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))))
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()
  try {
    await setup.waitForFrame((frame) => frame.includes(`Answer ${count / 2 - 1}`))
    const hydrationMs = performance.now() - started
    const latency: number[] = []
    const cpu = process.cpuUsage()
    const deadline = Date.now() + duration
    const loops = duration ? Number.POSITIVE_INFINITY : 10
    for (let n = 0; n < loops; n++) {
      const start = performance.now()
      setup.mockInput.pressKey("o", { ctrl: true })
      await setup.waitForFrame((frame) => frame.includes("Search sessions"))
      latency.push(performance.now() - start)
      setup.mockInput.pressEscape()
      await setup.waitForFrame((frame) => !frame.includes("Search sessions") && frame.includes(`Answer ${count / 2 - 1}`))
      if (duration) {
        events.emit({ id: `evt_background_${n}`, created: Date.now(), type: "session.synthetic",
          durable: { aggregateID: "ses_background", seq: n + 1, version: 1 }, data: { sessionID: "ses_background", text: `Background ${n}` } })
        if (n % 10 === 9) events.disconnect()
        record({ scenario: "soak-sample", count, width, iteration: n, elapsedMs: duration - Math.max(0, deadline - Date.now()), keyboardMs: latency.at(-1), after: memory(), eventLoopP99Ms: delay.percentile(99) / 1e6 })
        if (Date.now() >= deadline) break
        await Bun.sleep(Math.min(60000, deadline - Date.now()))
      }
    }
    record({ scenario: duration ? "soak-finished" : "render", count, width, hydrationMs, before, after: memory(),
      keyboardSamples: latency.length, keyboardMedianMs: quantile(latency, .5), keyboardP95Ms: quantile(latency, .95),
      eventLoopP99Ms: delay.percentile(99) / 1e6, cpuMicroseconds: process.cpuUsage(cpu), durationMs: duration })
    expect(latency).not.toHaveLength(0)
    expect(setup.captureCharFrame()).toContain(`Answer ${count / 2 - 1}`)
  } finally {
    delay.disable(); clearInterval(heartbeat); setup.renderer.destroy(); await task; await server.stop()
  }
}

for (const [count, width] of [[1000, 44], [1000, 112], [10000, 44], [10000, 112]]) {
  test(`loaded history ${count} at width ${width}`, async () => {
    await renderProbe(count, width)
  }, 60000)
}

const soak = Number(process.env.AUDIT_SOAK_MS ?? 0)
if (soak > 0) test("continuous production TUI fixture soak", async () => {
  await renderProbe(10000, 112, soak)
}, soak + 120000)
