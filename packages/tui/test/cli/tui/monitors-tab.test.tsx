/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { MonitorPublicInfo, OpenCodeEvent } from "@opencode/client"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { ComposerContext, type ComposerTab } from "../../../src/routes/session/composer/context"
import { ComposerFooter } from "../../../src/routes/session/composer/footer"
import {
  createSessionMonitors,
  MonitorsIndicator,
  MonitorsTab,
  type MonitorApi,
  type SessionMonitors,
} from "../../../src/routes/session/composer/monitors-tab"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

function monitor(input: Partial<MonitorPublicInfo> & Pick<MonitorPublicInfo, "id" | "command">): MonitorPublicInfo {
  return {
    sessionID: "parent",
    workdir: directory,
    options: { mode: "poll", interval_ms: 2_000, deadline_ms: 600_000 },
    status: "running",
    created: Date.now(),
    updated: Date.now(),
    attempts: 1,
    delivery: "pending",
    ...input,
  }
}

function progress(info: Pick<MonitorPublicInfo, "id" | "attempts" | "updated">, output: string, sessionID = "parent") {
  return {
    id: `evt_monitor_progress_${sessionID}_${info.id}_${info.attempts}_${output.length}`,
    created: Date.now(),
    type: "monitor.progress",
    data: {
      sessionID,
      monitorID: info.id,
      attempts: info.attempts,
      updated: info.updated,
      evidence: { exit: null, output, truncated: false },
    },
  } satisfies OpenCodeEvent
}

async function renderMonitors(initial: MonitorPublicInfo[], width = 100) {
  const store = {
    list: initial,
    reads: 0,
    delay: undefined as ((list: MonitorPublicInfo[]) => Promise<MonitorPublicInfo[]>) | undefined,
  }
  const cancelled: string[] = []
  const api: MonitorApi = {
    list: () => {
      store.reads += 1
      const list = structuredClone(store.list)
      const delay = store.delay
      store.delay = undefined
      return delay ? delay(list) : Promise.resolve(list)
    },
    cancel: async (input) => {
      cancelled.push(input.monitorID)
      store.list = store.list.map(
        (info): MonitorPublicInfo =>
          info.id === input.monitorID ? { ...info, status: "cancelled", delivery: "suppressed" } : info,
      )
      return structuredClone(store.list.find((info) => info.id === input.monitorID)!)
    },
  }
  let monitors!: SessionMonitors
  let toast!: ReturnType<typeof useToast>
  let dispatch!: ReturnType<typeof Keymap.use>["dispatch"]
  const [open, setOpen] = createSignal(true)
  const [tab, setTab] = createSignal<ComposerTab>()
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/parent") return undefined
    return json({
      data: {
        id: "parent",
        projectID: "proj_test",
        title: "Parent",
        agent: "build",
        location: { directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: 0 },
      },
    })
  }, events)

  function Content() {
    toast = useToast()
    const keymap = Keymap.use()
    dispatch = keymap.dispatch
    createEffect(() => {
      if (!open()) return
      const pop = keymap.mode.push("composer")
      onCleanup(pop)
    })
    monitors = createSessionMonitors({ sessionID: () => "parent", onOpen: () => setOpen(true), api })
    return (
      <box>
        <ComposerContext.Provider
          value={{
            register: (value) => {
              setTab(value)
              return () => setTab(undefined)
            },
            active: (id) => open() && id === "monitors",
            close: () => setOpen(false),
          }}
        >
          <text>Monitors</text>
          <MonitorsTab monitors={monitors} />
          <ComposerFooter hints={tab()?.hints?.() ?? []} />
        </ComposerContext.Provider>
        <MonitorsIndicator monitors={monitors} onOpen={() => setOpen(true)} />
      </box>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={directory}>
        <ConfigProvider config={createTuiResolvedConfig({}, { terminal: false })}>
          <Keymap.Provider>
            <ClientProvider api={createApi(calls.fetch)}>
              <DataProvider directory={process.cwd()}>
                <LocationProvider>
                  <RouteProvider initialRoute={{ type: "session", sessionID: "parent" }}>
                    <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                      <ToastProvider>
                        <DialogProvider>
                          <Content />
                        </DialogProvider>
                      </ToastProvider>
                    </ThemeProvider>
                  </RouteProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 24, kittyKeyboard: true },
  )
  await wait(() => monitors?.list().length === initial.length)
  await app.renderOnce()
  return {
    app,
    cancelled,
    store,
    monitors: () => monitors,
    info: (id: string) => monitors.list().find((info) => info.id === id),
    toast: () => toast.currentToast,
    dispatch: (command: string) => dispatch(command),
    setOpen,
    emit: events.emit,
    /** Capture one list response before an event or cancellation, then release it after that update. */
    deferRead: () => {
      const ready = Promise.withResolvers<() => Promise<MonitorPublicInfo[]>>()
      store.delay = (list) => {
        const pending = Promise.withResolvers<MonitorPublicInfo[]>()
        ready.resolve(() => {
          pending.resolve(list)
          return pending.promise
        })
        return pending.promise
      }
      return ready.promise
    },
    /** Re-reads until the shared list matches, since a read already in flight skips a new one. */
    settle: async (predicate: (list: readonly MonitorPublicInfo[]) => boolean) => {
      await wait(() => {
        monitors.refresh()
        return predicate(monitors.list())
      })
      await app.renderOnce()
    },
  }
}

test("the Monitors tab lists live monitors and omits settled results", async () => {
  const view = await renderMonitors([
    monitor({
      id: "done",
      command: "gh run view 42 --json status",
      status: "succeeded",
      delivery: "delivered",
      created: Date.now() - 60_000,
      updated: Date.now() - 30_000,
      attempts: 3,
      evidence: { exit: 0, output: "completed", truncated: false, matched: "exit code 0" },
    }),
    monitor({ id: "live", command: "probe: GET https://example.com/health" }),
  ])
  try {
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("Monitors")
    expect(frame).toContain("probe: GET https://example.com/health")
    expect(frame).not.toContain("gh run view 42")
    expect(frame).toMatch(/running\s+(10m 0s|9m \d+s) left/)
    expect(frame).not.toContain("succeeded")
    expect(frame).not.toContain("delivered")
    expect(frame).not.toContain("3 checks · exit code 0")
    expect(frame).toContain("1 monitor")
  } finally {
    view.app.renderer.destroy()
  }
})

test("the Monitors tab expands evidence and stops a running monitor through the API", async () => {
  const view = await renderMonitors([
    monitor({
      id: "live",
      command: "watch-build",
      attempts: 2,
      evidence: { exit: 1, output: "Build started\nStill compiling", truncated: false },
    }),
  ])
  try {
    expect(view.app.captureCharFrame()).toContain("2 checks · Still compiling")
    expect(view.app.captureCharFrame()).not.toContain("Build started")
    const evidence = view.app.renderer.root.findDescendantById("monitor-evidence-live")!
    expect(view.app.captureCharFrame().match(/evidence/g)).toHaveLength(1)
    await view.app.mockMouse.click(evidence.x, evidence.y)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("Build started")

    const stop = view.app.renderer.root.findDescendantById("monitor-stop-live")!
    await view.app.mockMouse.click(stop.x, stop.y)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("Stop observing watch-build?")
    view.app.mockInput.pressEnter()
    await wait(() =>
      view
        .monitors()
        .list()
        .some((info) => info.status === "cancelled"),
    )
    await view.app.renderOnce()
    expect(view.cancelled).toEqual(["live"])
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("No active monitors in this session")
    expect(view.app.renderer.root.findDescendantById("monitor-stop-live")).toBeUndefined()
    expect(frame).not.toContain("1 monitor")
    // A cancellation the user asked for is not announced as a finish.
    expect(view.toast()?.message).toBe("Stopped monitoring watch-build")
  } finally {
    view.app.renderer.destroy()
  }
})

test("many monitors and expanded evidence stay in the drawer scroll without moving its controls", async () => {
  const view = await renderMonitors(
    Array.from({ length: 40 }, (_, index) =>
      monitor({
        id: `monitor-${index}`,
        command: `watch-job-${index}`,
        created: Date.now() - index,
        evidence: {
          exit: 0,
          output: Array.from({ length: 40 }, (_, line) => `evidence-line-${line}`).join("\n"),
          truncated: false,
        },
      }),
    ),
  )
  try {
    const scroll = view.app.renderer.root.findDescendantById("composer-monitors-scroll")
    expect(scroll).toBeInstanceOf(ScrollBoxRenderable)
    if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing monitor scroll")
    const controls = () => view.app.renderer.root.findDescendantById("monitor-stop-monitor-0")!
    const controlsY = controls().y
    expect(view.app.renderer.root.findDescendantById("composer-actions")?.height).toBe(1)
    expect(scroll.height).toBe(5)
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
    view.dispatch("composer.monitor.evidence")
    await view.app.renderOnce()
    expect(scroll.height).toBe(5)
    expect(controls().y).toBe(controlsY)
    expect(view.app.captureCharFrame()).toContain("hide evidence")
    scroll.scrollBy(30)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("evidence-line-30")
    expect(controls().y).toBe(controlsY)
    view.dispatch("composer.monitor.evidence")
    await view.app.renderOnce()
    for (let index = 0; index < 39; index++) {
      view.dispatch("composer.monitor.down")
      await view.app.waitFor(() =>
        Boolean(view.app.renderer.root.findDescendantById(`monitor-stop-monitor-${index + 1}`)),
      )
      await view.app.renderOnce()
    }
    expect(view.app.captureCharFrame()).toContain("watch-job-39")
    expect(scroll.height).toBe(5)
  } finally {
    view.app.renderer.destroy()
  }
})

test("a monitor that finishes toasts only while the Monitors tab is out of sight", async () => {
  const view = await renderMonitors([
    monitor({ id: "first", command: "first-check" }),
    monitor({ id: "second", command: "second-check" }),
  ])
  try {
    expect(view.app.captureCharFrame()).toContain("2 monitors")
    view.store.list = view.store.list.map(
      (info): MonitorPublicInfo => (info.id === "first" ? { ...info, status: "succeeded" } : info),
    )
    await view.settle((list) => list.some((info) => info.id === "first" && info.status === "succeeded"))
    expect(view.toast()).toBeNull()
    expect(view.app.captureCharFrame()).not.toContain("first-check")
    expect(view.app.renderer.root.findDescendantById("monitor-stop-second")).toBeDefined()

    view.setOpen(false)
    await view.app.renderOnce()
    view.store.list = view.store.list.map(
      (info): MonitorPublicInfo => (info.id === "second" ? { ...info, status: "failed" } : info),
    )
    await view.settle((list) => list.every((info) => info.status !== "running"))
    expect(view.toast()).toMatchObject({ variant: "error", message: "Monitor failed: second-check" })
    expect(view.app.captureCharFrame()).not.toContain("monitor")
  } finally {
    view.app.renderer.destroy()
  }
})

test("a monitor event re-reads the list without polling while the Monitors tab is hidden", async () => {
  const view = await renderMonitors([monitor({ id: "build", command: "watch-build" })])
  try {
    view.setOpen(false)
    await view.app.renderOnce()
    view.store.list = view.store.list.map((info): MonitorPublicInfo => ({ ...info, status: "succeeded" }))
    view.emit({
      id: "evt_monitor_finished",
      created: Date.now(),
      type: "monitor.finished",
      data: { sessionID: "parent", monitorID: "build", command: "watch-build", status: "succeeded" },
    })
    await wait(() =>
      view
        .monitors()
        .list()
        .every((info) => info.status === "succeeded"),
    )
    await view.app.renderOnce()
    expect(view.toast()).toMatchObject({ variant: "success", message: "Monitor succeeded: watch-build" })
  } finally {
    view.app.renderer.destroy()
  }
})

test.each([50, 120])("progress uses the existing bounded drawer at %i columns", async (width) => {
  const view = await renderMonitors([monitor({ id: "health", command: "watch-health", updated: 100 })], width)
  try {
    view.setOpen(false)
    await view.app.renderOnce()
    const reads = view.store.reads
    view.emit(
      progress(
        { id: "health", attempts: 2, updated: 50 },
        `${Array.from({ length: 60 }, (_, index) => `checkpoint-${index}`).join("\n")}\n\u001b[31mWaiting for readiness\u001b[0m\u0000`,
      ),
    )
    await wait(() => view.monitors().list()[0]?.attempts === 2)
    expect(view.store.reads).toBe(reads)
    expect(view.toast()).toBeNull()

    // Opening also fetches the older fixture snapshot; the event's newer attempt must survive that read.
    view.setOpen(true)
    await view.app.renderOnce()
    const scroll = view.app.renderer.root.findDescendantById("composer-monitors-scroll")
    if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing monitor scroll")
    const actions = view.app.renderer.root.findDescendantById("composer-actions")
    if (!(actions instanceof ScrollBoxRenderable)) throw new Error("Missing monitor actions")
    const actionsY = actions.y
    expect(scroll.height).toBe(5)
    expect(scroll.getChildren()[0]?.height).toBe(2)
    expect(actions.height).toBe(1)
    expect(view.app.captureCharFrame()).toContain("2 checks · Waiting for readiness")
    expect(view.app.captureCharFrame()).not.toContain("\u001b")
    expect(view.app.captureCharFrame()).not.toContain("\u0000")
    const labels = actions.getChildren().filter((node): node is TextRenderable => node instanceof TextRenderable)
    expect(labels.map((node) => node.plainText.split(" ")[0])).toEqual(["evidence", "stop", "scroll", "refresh"])
    // Narrow terminals scroll the single action row horizontally; reveal refresh before counting its visible label.
    actions.scrollTo({ x: actions.scrollWidth, y: 0 })
    await view.app.renderOnce()
    expect(view.app.captureCharFrame().match(/refresh/g)).toHaveLength(1)
    const refresh = labels.find((node) => node.plainText.startsWith("refresh "))!
    expect(refresh.y).toBe(actionsY)
    expect(refresh.height).toBe(1)
    expect(refresh.x).toBeGreaterThanOrEqual(actions.x)
    expect(refresh.x + refresh.width).toBeLessThanOrEqual(actions.x + actions.width)

    view.dispatch("composer.monitor.evidence")
    await view.app.renderOnce()
    scroll.scrollTo(scroll.scrollHeight)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("Waiting for readiness")
    expect(scroll.height).toBe(5)
    expect(actions.height).toBe(1)
    expect(actions.y).toBe(actionsY)
  } finally {
    view.app.renderer.destroy()
  }
})

test("progress ignores other sessions, absent or terminal monitors and older or duplicate attempts", async () => {
  const view = await renderMonitors([
    monitor({ id: "live", command: "watch-health", attempts: 3, updated: 30 }),
    monitor({ id: "done", command: "settled-health", status: "failed", attempts: 2 }),
    monitor({ id: "sentinel", command: "watch-sentinel" }),
  ])
  try {
    view.setOpen(false)
    await view.app.renderOnce()
    const reads = view.store.reads
    view.emit(progress({ id: "live", attempts: 9, updated: 90 }, "other session", "other"))
    view.emit(progress({ id: "absent", attempts: 9, updated: 90 }, "unknown monitor"))
    view.emit(progress({ id: "done", attempts: 9, updated: 90 }, "terminal monitor"))
    view.emit(progress({ id: "live", attempts: 3, updated: 90 }, "duplicate attempt"))
    view.emit(progress({ id: "live", attempts: 2, updated: 90 }, "older attempt"))
    view.emit(progress({ id: "sentinel", attempts: 2, updated: 90 }, "events received"))
    await wait(() => view.info("sentinel")?.attempts === 2)
    expect(view.monitors().list()).toHaveLength(3)
    expect(view.info("live")).toMatchObject({ attempts: 3, updated: 30 })
    expect(view.info("live")?.evidence).toBeUndefined()
    expect(view.info("done")).toMatchObject({ status: "failed", attempts: 2 })
    view.emit(progress({ id: "live", attempts: 4, updated: 20 }, "newest attempt"))
    await wait(() => view.info("live")?.attempts === 4)
    expect(view.info("live")).toMatchObject({
      updated: 20,
      evidence: { output: "newest attempt" },
    })
    expect(view.info("done")).toMatchObject({ status: "failed", attempts: 2 })
    expect(view.store.reads).toBe(reads)
    expect(view.toast()).toBeNull()
  } finally {
    view.app.renderer.destroy()
  }
})

test("an older in-flight read preserves progress and terminal results win even with equal timestamps", async () => {
  const view = await renderMonitors([
    monitor({ id: "live", command: "watch-health", updated: 100 }),
    monitor({ id: "sentinel", command: "watch-sentinel", updated: 100 }),
  ])
  try {
    view.setOpen(false)
    await view.app.renderOnce()
    const pending = view.deferRead()
    view.monitors().refresh()
    const release = await pending
    view.emit(progress({ id: "live", attempts: 2, updated: 50 }, "new evidence"))
    await wait(() => view.info("live")?.attempts === 2)
    await release()
    await view.app.renderOnce()
    expect(view.info("live")).toMatchObject({
      attempts: 2,
      updated: 50,
      evidence: { output: "new evidence" },
    })

    view.store.list = view.store.list.map(
      (info): MonitorPublicInfo =>
        info.id === "live"
          ? {
              ...info,
              status: "succeeded",
              attempts: 2,
              updated: 50,
              evidence: { exit: 0, output: "final evidence", truncated: false },
            }
          : info,
    )
    view.emit({
      id: "evt_monitor_progress_finished",
      created: Date.now(),
      type: "monitor.finished",
      data: { sessionID: "parent", monitorID: "live", command: "watch-health", status: "succeeded" },
    })
    await wait(() => view.info("live")?.status === "succeeded")
    expect(view.toast()).toMatchObject({ variant: "success", message: "Monitor succeeded: watch-health" })
    view.emit(progress({ id: "live", attempts: 3, updated: 60 }, "late progress"))
    view.emit(progress({ id: "sentinel", attempts: 2, updated: 60 }, "still live"))
    await wait(() => view.info("sentinel")?.attempts === 2)
    expect(view.info("live")).toMatchObject({
      status: "succeeded",
      evidence: { output: "final evidence" },
    })
    view.setOpen(true)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).not.toContain("watch-health")
  } finally {
    view.app.renderer.destroy()
  }
})

test("a read captured before cancellation cannot revive the stopped monitor", async () => {
  const view = await renderMonitors([monitor({ id: "live", command: "watch-health" })])
  try {
    view.setOpen(false)
    await view.app.renderOnce()
    const pending = view.deferRead()
    view.monitors().refresh()
    const release = await pending
    await view.monitors().cancel(view.monitors().list()[0]!)
    await release()
    await view.app.renderOnce()
    expect(view.monitors().list()[0]?.status).toBe("cancelled")
    expect(view.toast()?.message).toBe("Stopped monitoring watch-health")
    view.setOpen(true)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("No active monitors in this session")
  } finally {
    view.app.renderer.destroy()
  }
})

test("a session without monitors shows no indicator and an empty tab", async () => {
  const view = await renderMonitors([])
  try {
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("No active monitors in this session")
    view.setOpen(false)
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).not.toContain("monitor")
  } finally {
    view.app.renderer.destroy()
  }
})

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
