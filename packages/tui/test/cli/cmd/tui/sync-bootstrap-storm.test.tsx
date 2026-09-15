/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@reddb-io/redcode-sdk/v2"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { KVProvider } from "../../../../src/context/kv"
import { ProjectProvider } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { PermissionProvider } from "../../../../src/context/permission"
import { ExitProvider } from "../../../../src/context/exit"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { tmpdir } from "../../../fixture/fixture"
import { createFetch, directory, json, mount, wait } from "./sync-fixture"

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

test("repeated dispose and reconnect triggers during bootstrap end with one trailing run and no cancelled reads", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch: Watch = { reads: { agent: 0, command: 0 }, cancelled: [], signals: 0 }
  const gate = deferred()
  let gated = false
  const { app, sync, emit } = await mount(async (url, input) => {
    const read = watchCatalog(url, input, watch)
    if (!read) return
    const n = watch.reads[read.key]
    const body = json(read.key === "agent" ? [agent(`agent_${n}`)] : [command(`command_${n}`)])
    return answer(read, gated && n === 2 ? gate.promise.then(() => body) : body)
  }, tmp.path)
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
    await Bun.sleep(300)

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
  const watch: Watch = { reads: { agent: 0, command: 0 }, cancelled: [], signals: 0 }
  const { app, sync } = await mount((url, input) => {
    const read = watchCatalog(url, input, watch)
    if (!read) return
    if (read.key === "agent" && watch.reads.agent === 1) return answer(read, new Response(null, { status: 499 }))
    if (read.key === "command" && watch.reads.command <= 2) return answer(read, new Response(null, { status: 499 }))
    return answer(read, json(read.key === "agent" ? [agent("build")] : [command("review")]))
  }, tmp.path)
  try {
    await wait(() => sync.data.command.length > 0)
    expect(sync.data.agent.map((item) => item.name)).toEqual(["build"])
    expect(sync.data.command.map((item) => item.name)).toEqual(["review"])
    expect(watch.reads).toEqual({ agent: 2, command: 3 })
  } finally {
    app.renderer.destroy()
  }
})

test("the first event stream connection starts bootstrap instead of superseding it", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const watch: Watch = { reads: { agent: 0, command: 0 }, cancelled: [], signals: 0 }
  const calls = createFetch((url, input) => {
    if (url.pathname === "/global/event") {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const connected = global({ id: "evt_connected", type: "server.connected", properties: {} })
            setTimeout(
              () => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(connected)}\n\n`)),
              30,
            )
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    const read = watchCatalog(url, input, watch)
    if (!read) return
    return answer(read, Bun.sleep(50).then(() => json(read.key === "agent" ? [agent("build")] : [command("review")])))
  })
  let sync!: ReturnType<typeof useSync>
  const ready = deferred()
  function Probe() {
    const ctx = useSync()
    onMount(() => {
      sync = ctx
      ready.resolve()
    })
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: tmp.path }}>
      <ArgsProvider>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={calls.fetch}>
            <PermissionProvider>
              <ProjectProvider>
                <ExitProvider exit={() => {}}>
                  <SyncProvider>
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
  try {
    await ready.promise
    await wait(() => sync.status === "complete")
    await Bun.sleep(300)
    expect(watch.cancelled).toEqual([])
    expect(watch.reads).toEqual({ agent: 1, command: 1 })
    expect(sync.data.agent.map((item) => item.name)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})
