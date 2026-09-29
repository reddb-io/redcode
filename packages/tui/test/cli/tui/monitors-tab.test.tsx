/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { MonitorPublicInfo } from "@opencode/client"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import {
  createSessionMonitors,
  MonitorsIndicator,
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

async function renderMonitors(initial: MonitorPublicInfo[]) {
  const store = { list: initial }
  const cancelled: string[] = []
  const api: MonitorApi = {
    list: async () => structuredClone(store.list),
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
  }, createEventStream())

  function Content() {
    toast = useToast()
    dispatch = Keymap.use().dispatch
    monitors = createSessionMonitors({ sessionID: () => "parent", onOpen: () => setOpen(true), api })
    return (
      <box>
        <Composer
          sessionID="parent"
          open={open()}
          defaultTab="monitors"
          monitors={monitors}
          onClose={() => setOpen(false)}
        />
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
    { width: 100, height: 24, kittyKeyboard: true },
  )
  await wait(() => monitors.list().length === initial.length)
  await app.renderOnce()
  return {
    app,
    cancelled,
    store,
    monitors: () => monitors,
    toast: () => toast.currentToast,
    dispatch: (command: string) => dispatch(command),
    setOpen,
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

test("the Monitors tab lists running monitors first with time left, results and delivery", async () => {
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
    expect(frame.indexOf("probe: GET https://example.com/health")).toBeLessThan(frame.indexOf("gh run view 42"))
    expect(frame).toMatch(/running\s+(10m 0s|9m \d+s) left/)
    expect(frame).toContain("succeeded")
    expect(frame).toContain("delivered")
    expect(frame).toContain("3 checks · exit code 0")
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
    view.dispatch("composer.monitor.evidence")
    await view.app.renderOnce()
    expect(view.app.captureCharFrame()).toContain("Build started")

    view.dispatch("composer.monitor.cancel")
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
    expect(frame).toContain("cancelled")
    expect(frame).not.toContain("1 monitor")
    // A cancellation the user asked for is not announced as a finish.
    expect(view.toast()?.message).toBe("Stopped monitoring watch-build")
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

test("a session without monitors shows no indicator and an empty tab", async () => {
  const view = await renderMonitors([])
  try {
    const frame = view.app.captureCharFrame()
    expect(frame).toContain("No monitors in this session")
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
