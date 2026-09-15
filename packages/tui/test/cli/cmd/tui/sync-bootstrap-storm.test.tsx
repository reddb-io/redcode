/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@reddb-io/redcode-sdk/v2"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { KVProvider } from "../../../../src/context/kv"
import { ProjectProvider } from "../../../../src/context/project"
import { SDKProvider, type EventSource } from "../../../../src/context/sdk"
import { SyncProvider, useSync, type SyncTiming } from "../../../../src/context/sync"
import { PermissionProvider } from "../../../../src/context/permission"
import { ExitProvider } from "../../../../src/context/exit"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { tmpdir } from "../../../fixture/fixture"
import { createEventSource, createFetch, directory, json, mount, wait } from "./sync-fixture"

// Deterministic timings: no jitter and delays short enough that no test waits on real backoff.
const fast: Partial<SyncTiming> = {
  settleMs: 20,
  streamGraceMs: 2000,
  recoveryBaseMs: 5,
  recoveryMaxMs: 20,
  retryMs: [1, 1, 1],
  jitter: (ms) => ms,
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

const agent = (name: string) => ({ name, mode: "primary", permission: [], options: {} })
const command = (name: string) => ({ name, template: name, hints: [] })

type Watch = { reads: { agent: number; command: number }; cancelled: string[]; signals: number }

function createWatch(): Watch {
  return { reads: { agent: 0, command: 0 }, cancelled: [], signals: 0 }
}

// Records a read as cancelled only when its signal aborts before the response is handed back,
// which is what makes the server answer 499.
function watchCatalog(url: URL, input: RequestInfo | URL, watch: Watch) {
  const key: keyof Watch["reads"] | undefined =
    url.pathname === "/agent" ? "agent" : url.pathname === "/command" ? "command" : undefined
  if (!key) return
  watch.reads[key]++
  const read = { key, pending: true }
  if (input instanceof Request) {
    watch.signals++
    input.signal.addEventListener("abort", () => read.pending && watch.cancelled.push(url.pathname), { once: true })
  }
  return read
}

async function answer(read: { pending: boolean }, response: Response | Promise<Response>) {
  const result = await response
  read.pending = false
  return result
}

// Renders the provider tree without waiting for sync to become ready, for tests that act during
// startup. `sync()` is undefined until the first bootstrap has delivered partial data.
async function renderSync(input: {
  state: string
  fetch: typeof globalThis.fetch
  events?: EventSource
  timing: Partial<SyncTiming>
  exit?: (error?: unknown) => void
}) {
  let current: ReturnType<typeof useSync> | undefined
  function Probe() {
    const ctx = useSync()
    onMount(() => {
      current = ctx
    })
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: input.state }}>
      <ArgsProvider>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={input.fetch} events={input.events}>
            <PermissionProvider>
              <ProjectProvider>
                <ExitProvider exit={input.exit ?? (() => {})}>
                  <SyncProvider timing={input.timing}>
                    <Probe />
                  </SyncProvider>
                </ExitProvider>
              </ProjectProvider>
            </PermissionProvider>
          </SDKProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))
  return { app, sync: () => current }
}

function eventStream(connectAfterMs?: number) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (connectAfterMs === undefined) return
        const connected = global({ id: "evt_connected", type: "server.connected", properties: {} })
        setTimeout(
          () => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(connected)}\n\n`)),
          connectAfterMs,
        )
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

test("repeated dispose and reconnect triggers during bootstrap end with one trailing run and no cancelled reads", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch = createWatch()
  const gate = deferred()
  let gated = false
  const { app, sync, emit } = await mount(
    async (url, input) => {
      const read = watchCatalog(url, input, watch)
      if (!read) return
      const n = watch.reads[read.key]
      const body = json(read.key === "agent" ? [agent(`agent_${n}`)] : [command(`command_${n}`)])
      return answer(read, gated && n === 2 ? gate.promise.then(() => body) : body)
    },
    tmp.path,
    undefined,
    { timing: fast },
  )
  try {
    expect(watch.reads).toEqual({ agent: 1, command: 1 })
    gated = true
    const inFlight = sync.bootstrap({ fatal: false })
    await wait(() => watch.reads.agent === 2 && watch.reads.command === 2)

    const storm: Promise<void>[] = []
    for (let i = 0; i < 5; i++) {
      emit(global({ id: `evt_disposed_${i}`, type: "server.instance.disposed", properties: { directory } }))
      storm.push(sync.bootstrap({ fatal: false }))
      await Bun.sleep(5)
    }
    // Nothing new starts while the first run is still waiting on its slow reads.
    expect(watch.reads).toEqual({ agent: 2, command: 2 })

    gate.resolve()
    await inFlight
    await Promise.all(storm)
    await wait(() => sync.status === "complete")
    await Bun.sleep(100)

    expect(watch.signals).toBeGreaterThan(0)
    expect(watch.cancelled).toEqual([])
    expect(watch.reads).toEqual({ agent: 3, command: 3 })
    expect(sync.data.agent.map((item) => item.name)).toEqual(["agent_3"])
    expect(sync.data.command.map((item) => item.name)).toEqual(["command_3"])
  } finally {
    app.renderer.destroy()
  }
})

test("cancelled agent and command reads are retried instead of leaving the catalog empty", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch = createWatch()
  const { app, sync } = await mount(
    (url, input) => {
      const read = watchCatalog(url, input, watch)
      if (!read) return
      if (read.key === "agent" && watch.reads.agent === 1) return answer(read, new Response(null, { status: 499 }))
      if (read.key === "command" && watch.reads.command <= 2) return answer(read, new Response(null, { status: 499 }))
      return answer(read, json(read.key === "agent" ? [agent("build")] : [command("review")]))
    },
    tmp.path,
    undefined,
    { timing: fast },
  )
  try {
    await wait(() => sync.data.command.length > 0)
    expect(sync.data.agent.map((item) => item.name)).toEqual(["build"])
    expect(sync.data.command.map((item) => item.name)).toEqual(["review"])
    expect(watch.reads).toEqual({ agent: 2, command: 3 })
  } finally {
    app.renderer.destroy()
  }
})

test("a startup run failing during a dispose hands its fatality to the queued re-sync instead of exiting", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const exits: unknown[] = []
  const gate = deferred()
  let configReads = 0
  const calls = createFetch(async (url) => {
    if (url.pathname === "/agent") return json([agent("build")])
    if (url.pathname !== "/config") return
    configReads++
    // The startup run's config read is held while the instance disposes, then every one of its
    // attempts sees the reloading instance.
    if (configReads === 1) return gate.promise.then(() => new Response(null, { status: 503 }))
    if (configReads <= 4) return new Response(null, { status: 503 })
    return json({})
  })
  const events = createEventSource({ buffer: false })
  const { app, sync } = await renderSync({
    state: tmp.path,
    fetch: calls.fetch,
    events: events.source,
    timing: fast,
    exit: (error) => exits.push(error),
  })
  try {
    await wait(() => configReads === 1)
    events.emit(global({ id: "evt_disposed", type: "server.instance.disposed", properties: { directory } }))
    gate.resolve()
    await wait(() => sync()?.status === "complete")
    expect(exits).toEqual([])
    expect(configReads).toBe(5)
    expect(sync()!.data.agent.map((item) => item.name)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("a startup run that fails with nothing queued still exits", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const exits: unknown[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/config") return new Response(null, { status: 500 })
  })
  const { app } = await renderSync({
    state: tmp.path,
    fetch: calls.fetch,
    events: createEventSource({ buffer: false }).source,
    timing: fast,
    exit: (error) => exits.push(error),
  })
  try {
    await wait(() => exits.length === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("a workspace switch takes over the queued re-sync instead of running another full bootstrap", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch = createWatch()
  const gate = deferred()
  let gated = false
  const { app, sync, project } = await mount(
    async (url, input) => {
      const read = watchCatalog(url, input, watch)
      if (!read) return
      const n = watch.reads[read.key]
      const body = json(read.key === "agent" ? [agent(`agent_${n}`)] : [command(`command_${n}`)])
      return answer(read, gated && n === 2 ? gate.promise.then(() => body) : body)
    },
    tmp.path,
    undefined,
    { timing: fast },
  )
  try {
    gated = true
    const old = sync.bootstrap({ fatal: false }).catch(() => {})
    await wait(() => watch.reads.agent === 2)
    const queued = sync.bootstrap({ fatal: false })
    project.workspace.set("ws_b")
    await sync.bootstrap({ fatal: false })
    await queued
    gate.resolve()
    await old
    await Bun.sleep(100)
    expect(watch.reads).toEqual({ agent: 3, command: 3 })
    expect(sync.data.agent.map((item) => item.name)).toEqual(["agent_3"])
  } finally {
    gate.resolve()
    app.renderer.destroy()
  }
})

test("background recovery stops at its limit and reports degraded data", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let failing = false
  let configReads = 0
  const { app, sync } = await mount(
    (url) => {
      if (url.pathname !== "/config") return
      configReads++
      if (failing) return new Response(null, { status: 500 })
    },
    tmp.path,
    undefined,
    { timing: { ...fast, recoveryLimit: 2 } },
  )
  try {
    expect(configReads).toBe(1)
    expect(sync.data.degraded).toEqual([])
    failing = true
    await expect(sync.bootstrap({ fatal: false })).rejects.toThrow()
    await wait(() => sync.data.degraded.includes("bootstrap"))
    await Bun.sleep(60)
    // Startup, the failed run, then exactly two recovery runs.
    expect(configReads).toBe(4)
  } finally {
    app.renderer.destroy()
  }
})

test("when only commands fail, only commands are read again", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const reads = { command: 0, agent: 0, session: 0 }
  const { app, sync } = await mount(
    (url) => {
      if (url.pathname === "/agent") reads.agent++
      if (url.pathname === "/session") reads.session++
      if (url.pathname !== "/command") return
      reads.command++
      if (reads.command === 1) return new Response(null, { status: 500 })
      return json([command("review")])
    },
    tmp.path,
    undefined,
    { timing: fast },
  )
  try {
    await wait(() => sync.data.command.length === 1)
    await Bun.sleep(60)
    expect(reads).toEqual({ command: 2, agent: 1, session: 1 })
    expect(sync.data.degraded).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test.each(["bootstrap recovery", "command retry"])("unmounting cancels a scheduled %s", async (kind) => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const reads = { config: 0, command: 0 }
  let failing = false
  const { app, sync } = await mount(
    (url) => {
      const key = url.pathname === "/config" ? "config" : url.pathname === "/command" ? "command" : undefined
      if (!key) return
      reads[key]++
      const fails = kind === "command retry" ? key === "command" : key === "config"
      if (failing && fails) return new Response(null, { status: 500 })
    },
    tmp.path,
    undefined,
    { timing: { ...fast, recoveryBaseMs: 80, recoveryMaxMs: 80 } },
  )
  failing = true
  await sync.bootstrap({ fatal: false }).catch(() => {})
  if (kind === "command retry") await wait(() => sync.status === "complete")
  const before = { ...reads }
  app.renderer.destroy()
  await Bun.sleep(200)
  expect(reads).toEqual(before)
})

test("the first event stream connection starts bootstrap instead of superseding it", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch = createWatch()
  const calls = createFetch((url, input) => {
    if (url.pathname === "/global/event") return eventStream(30)
    const read = watchCatalog(url, input, watch)
    if (!read) return
    return answer(read, Bun.sleep(50).then(() => json(read.key === "agent" ? [agent("build")] : [command("review")])))
  })
  const { app, sync } = await renderSync({ state: tmp.path, fetch: calls.fetch, timing: fast })
  try {
    await wait(() => sync()?.status === "complete")
    await Bun.sleep(100)
    expect(watch.cancelled).toEqual([])
    expect(watch.reads).toEqual({ agent: 1, command: 1 })
    expect(sync()!.data.agent.map((item) => item.name)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("bootstrap starts after the grace period when the event stream never connects", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch = createWatch()
  const calls = createFetch((url, input) => {
    if (url.pathname === "/global/event") return eventStream()
    const read = watchCatalog(url, input, watch)
    if (!read) return
    return answer(read, json(read.key === "agent" ? [agent("build")] : [command("review")]))
  })
  const { app, sync } = await renderSync({
    state: tmp.path,
    fetch: calls.fetch,
    timing: { ...fast, streamGraceMs: 20 },
  })
  try {
    await wait(() => sync()?.status === "complete", 500)
    expect(watch.reads).toEqual({ agent: 1, command: 1 })
  } finally {
    app.renderer.destroy()
  }
})
