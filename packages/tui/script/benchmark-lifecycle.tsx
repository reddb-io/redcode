/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { useEvent } from "../src/context/event"
import { SESSION_CACHE_LIMIT } from "../src/context/sync"
import { tmpdir } from "../test/fixture/fixture"
import { directory, mount, wait } from "../test/cli/cmd/tui/sync-fixture"

// Run from packages/tui: bun run script/benchmark-lifecycle.tsx --seconds 30
// Set --seconds 7200 for the full soak; no real server, providers, DB, or user processes are touched.
const index = process.argv.indexOf("--seconds")
const seconds = index < 0 ? 10 : Number(process.argv[index + 1])
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--seconds must be positive")
const intervalIndex = process.argv.indexOf("--interval-ms")
const interval = intervalIndex < 0 ? 0 : Number(process.argv[intervalIndex + 1])
if (!Number.isFinite(interval) || interval < 0) throw new Error("--interval-ms must be nonnegative")
const stopIndex = process.argv.indexOf("--stop-file")
const stopFile = stopIndex < 0 ? undefined : process.argv[stopIndex + 1]
if (stopIndex >= 0 && !stopFile) throw new Error("--stop-file requires a path")
let stopped = false
const stop = () => {
  stopped = true
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
await using tmp = await tmpdir()
await Bun.write(`${tmp.path}/kv.json`, "{}")
const [shown, setShown] = createSignal(true)
const latencies: number[] = []
const renderLatencies: number[] = []
const samples: Array<{ seconds: number; rss: number; heap: number }> = []
let sent = 0
let callbacks = 0
let mounts = 0
let events = 0
function Consumer() {
  mounts++
  useEvent().on("session.status", () => callbacks++)
  useKeyboard(() => latencies.push(performance.now() - sent))
  return <text>Lifecycle benchmark</text>
}
const fixture = await mount(undefined, tmp.path, () => (
  <Show when={shown()}>
    <Consumer />
  </Show>
))
const start = performance.now()
let iterations = 0
let lastProgress = start
try {
  while (!stopped && performance.now() - start < seconds * 1000) {
    if (stopFile && (await Bun.file(stopFile).exists())) {
      stopped = true
      break
    }
    for (let index = 0; index < 10; index++) {
      setShown(false)
      setShown(true)
    }
    const sessionID = `ses_soak_${iterations}`
    const messageID = `msg_soak_${iterations}`
    fixture.emit({
      directory,
      payload: {
        id: `evt_message_${iterations}`,
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            id: messageID,
            sessionID,
            role: "user",
            agent: "build",
            model: { providerID: "fixture", modelID: "fixture" },
            time: { created: iterations },
          },
        },
      },
    })
    fixture.emit({
      directory,
      payload: {
        id: `evt_part_${iterations}`,
        type: "message.part.updated",
        properties: {
          sessionID,
          time: iterations,
          part: { id: `prt_${iterations}`, messageID, sessionID, type: "text", text: "x".repeat(10000) },
        },
      },
    })
    fixture.emit({
      directory,
      payload: {
        id: `evt_status_${iterations}`,
        type: "session.status",
        properties: { sessionID: "ses_status", status: { type: "idle" } },
      },
    })
    events++
    await wait(() => callbacks >= events)
    if (callbacks !== events) throw new Error(`Listener retention: ${callbacks} callbacks for ${events} events`)
    if (
      Object.keys(fixture.sync.data.message).length > SESSION_CACHE_LIMIT ||
      Object.keys(fixture.sync.data.part).length > SESSION_CACHE_LIMIT
    )
      throw new Error("Session cache exceeded its bound")
    sent = performance.now()
    fixture.app.mockInput.pressKey("x")
    await fixture.app.renderOnce()
    renderLatencies.push(performance.now() - sent)
    iterations++
    if (!samples.length || performance.now() - start >= samples.at(-1)!.seconds * 1000 + 1000) {
      const usage = process.memoryUsage()
      samples.push({ seconds: (performance.now() - start) / 1000, rss: usage.rss, heap: usage.heapUsed })
    }
    if (performance.now() - lastProgress >= 60000) {
      lastProgress = performance.now()
      console.error(
        JSON.stringify({
          elapsedSeconds: (lastProgress - start) / 1000,
          iterations,
          mounts,
          callbacks,
          cacheEntries: Object.keys(fixture.sync.data.message).length,
          memory: samples.at(-1),
        }),
      )
    }
    if (interval) await Bun.sleep(interval)
  }
  const metrics = (values: number[]) => {
    const sorted = values.toSorted((a, b) => a - b)
    return {
      samples: sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted.at(-1),
    }
  }
  if (latencies.length !== iterations) throw new Error(`Lost input: ${latencies.length}/${iterations}`)
  console.log(
    JSON.stringify(
      {
        completed: !stopped && performance.now() - start >= seconds * 1000,
        requestedSeconds: seconds,
        elapsedSeconds: (performance.now() - start) / 1000,
        iterations,
        mounts,
        events,
        callbacks,
        cachedSessions: Object.keys(fixture.sync.data.message).length,
        cachedPartOwners: Object.keys(fixture.sync.data.part).length,
        inputDispatchMs: metrics(latencies),
        inputThroughRenderMs: metrics(renderLatencies),
        memory: samples,
      },
      null,
      2,
    ),
  )
} finally {
  process.off("SIGINT", stop)
  process.off("SIGTERM", stop)
  fixture.app.renderer.destroy()
}
