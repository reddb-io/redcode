import { afterEach, expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const started = "2026-08-15T20:00:00.000Z"
const session = {
  id: "session-1",
  title: "Workers session",
  slug: "workers-session",
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 0, updated: 0 },
}

function worker(id: string, issue: string, phase: string, index: number, extra: Record<string, unknown> = {}) {
  const { project_label, ...display } = extra as { project_label?: string }
  return {
    worker_id: id,
    project_label: project_label ?? "reddb-io/redcode",
    pid: 4000 + index,
    started_at: started,
    uptime_ms: 720_000,
    vitals: { rss_bytes: 412 * 1024 ** 2, sampled_at: started, age_ms: 300, fresh: true },
    budget: {
      declared: "2G",
      bytes: 2 * 1024 ** 3,
      used_bytes: 820 * 1024 ** 2,
      used_fraction: 0.41,
      enforceable: true,
    },
    log: { last_line: `running step ${index}`, published_at: started },
    display: {
      runner: "claude",
      model: "claude-fable-5",
      effort: "high",
      origin: "afk",
      issue,
      phase,
      step: "bun test",
      phase_index: index + 2,
      phase_total: 5,
      failed: false,
      heartbeat: new Date().toISOString(),
      started_at: started,
      context: 0.38,
      eta: 240,
      added: 120,
      removed: 14,
      tokens: 42_100 + index * 1_000,
      tools: 88,
      reasoning: 12_000,
      text: 8_000,
      ...display,
    },
  }
}

function status(input: { workers: ReturnType<typeof worker>[]; registered?: boolean }) {
  return {
    lifecycle: "live",
    consent: "accepted",
    scope: "project",
    native: true,
    activation: {
      eligible: true,
      project: "reddb-io/redcode",
      runner: "claude",
      target: 2,
      standing: false,
      config: ".red/config.yaml",
    },
    payload: {
      version: 1,
      generated_at: new Date().toISOString(),
      daemon: { pid: 324, daemon_version: "3.18.12", protocol_version: 1, started_at: started },
      staleness: {
        sampled_at: started,
        age_ms: 120,
        threshold_ms: 5_000,
        stale: false,
        measured_worker_count: input.workers.length,
        unmeasured_workers: [],
        reason: "fresh",
      },
      host: {
        worker_count: input.workers.length,
        project_count: 1,
        observed_rss_bytes: 4.1 * 1024 ** 3,
        measured_worker_count: input.workers.length,
        ceiling_used_fraction: 0.27,
        ceiling: { memory_bytes: 15.3 * 1024 ** 3, worker_count: 6, interactive_reservation: 1 },
      },
      registered_projects: input.registered === false ? [] : ["reddb-io/redcode"],
      workers: input.workers,
    },
    last_success_at: started,
  }
}

async function mountWorkers(input: {
  workers: ReturnType<typeof worker>[]
  registered?: boolean
  width?: number
  height?: number
}) {
  const setup = await createTestRenderer({
    width: input.width ?? 140,
    height: input.height ?? 40,
    useThread: false,
  })
  const core = await import("@opentui/core")
  void mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/redskilled") return json(status({ workers: input.workers, registered: input.registered }))
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${session.id}`) return json(session)
    if (url.pathname === `/session/${session.id}/message`) return json([])
    if (url.pathname === `/session/${session.id}/todo`) return json([])
    if (url.pathname === `/session/${session.id}/diff`) return json([])
    return undefined
  })
  let api: TuiPluginApi | undefined
  let ready!: () => void
  const booted = new Promise<void>((resolve) => {
    ready = resolve
  })

  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: events.source,
      args: {},
      pluginHost: {
        async start(started) {
          api = started.api
          ready()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )

  await booted
  api?.ui.dialog.clear()
  api?.route.navigate("session", { sessionID: session.id })
  await setup.renderOnce()
  await setup.renderOnce()
  api?.keymap.dispatchCommand("workers.show")

  return {
    setup,
    route: () => api?.route.current,
    dispatch: (command: string) => api?.keymap.dispatchCommand(command),
    blur: () => setup.renderer.currentFocusedEditor?.blur(),
    sidebarWidth: () => setup.renderer.root.findDescendantById("session-sidebar")?.width,
    async dragSidebar(columns: number) {
      const handle = setup.renderer.root.findDescendantById("session-sidebar-resize")
      if (!handle) throw new Error("missing sidebar resize handle")
      expect(handle.width).toBe(1)
      expect(handle.height).toBeGreaterThan(5)
      expect(handle.screenX).toBeGreaterThan(0)
      await setup.mockMouse.drag(handle.screenX, handle.screenY + 5, handle.screenX - columns, handle.screenY + 5)
      await setup.renderOnce()
    },
    frame: async () => {
      await setup.renderOnce()
      return setup.captureCharFrame()
    },
    async waitFor(text: string, timeout = 5_000) {
      const start = Date.now()
      while (!setup.captureCharFrame().includes(text)) {
        if (Date.now() - start > timeout) {
          throw new Error(`timed out waiting for ${JSON.stringify(text)}\n${setup.captureCharFrame()}`)
        }
        await Bun.sleep(20)
        await setup.renderOnce()
      }
      return setup.captureCharFrame()
    },
    async close() {
      api?.keymap.dispatchCommand("app.exit")
      await task
    },
  }
}

afterEach(() => mock.restore())

test("workers render in the session sidebar and preserve the session column", async () => {
  const app = await mountWorkers({
    workers: [worker("h9977", "123", "implement", 0), worker("hSMIB", "124", "gate", 1, { failed: true })],
  })
  try {
    let screen = await app.waitFor("h9977")

    expect(app.route()).toEqual({ name: "session", params: { sessionID: session.id } })
    expect(screen).toContain("Context")
    expect(screen).toContain("Workers (2 ✗1)")
    expect(screen).toContain("● live")
    expect(screen).toContain("claude × 2")

    expect(screen).toContain("▶ h9977")
    expect(screen).toContain("#123")
    expect(screen).toContain("implement 2/5")
    expect(screen).toContain("gate 3/5")

    const initialWidth = app.sidebarWidth()
    expect(initialWidth).toBeNumber()
    app.dispatch("session.sidebar.width.decrease")
    await app.frame()
    expect(app.sidebarWidth()).toBe(Math.max(30, initialWidth! - 4))
    app.dispatch("session.sidebar.width.increase")
    await app.frame()
    expect(app.sidebarWidth()).toBe(initialWidth)
    await app.dragSidebar(-6)
    expect(app.sidebarWidth()).toBe(Math.max(30, initialWidth! - 6))

    app.dispatch("session.sidebar.tab.cycle")
    screen = await app.frame()
    expect(screen).not.toContain("▶ h9977")
    app.dispatch("session.sidebar.tab.cycle")
    await app.waitFor("▶ h9977")

    app.blur()
    app.setup.mockInput.pressKey("j")
    screen = await app.waitFor("▶ hSMIB")
    expect(screen).not.toContain("▶ h9977")

    app.setup.mockInput.pressEnter()
    // The runner/model line is truncated to the panel width, which is resizable here, so the
    // detail view is recognised by content that does not depend on how wide the sidebar is.
    screen = await app.waitFor("+120 -14")
    expect(screen).not.toContain("▶ hSMIB")
    expect(screen).toContain("claude · ")
    expect(screen).toContain("enter back · j/k select")
    app.setup.mockInput.pressEnter()
    await app.waitFor("▶ hSMIB")

    await app.close()
  } finally {
    if (!app.setup.renderer.isDestroyed) app.setup.renderer.destroy()
  }
}, 15_000)

test("an empty fleet explains why no Worker is running", async () => {
  const app = await mountWorkers({ workers: [], width: 110, height: 26 })
  try {
    const screen = await app.waitFor("No live Workers")
    expect(screen).toContain("Target 2")
    expect(screen).toContain("z resize · p stop")

    await app.close()
  } finally {
    if (!app.setup.renderer.isDestroyed) app.setup.renderer.destroy()
  }
}, 15_000)

test("inactive drain is an explicit action without consent or disabled messaging", async () => {
  const app = await mountWorkers({ workers: [], registered: false, width: 110, height: 26 })
  try {
    const screen = await app.waitFor("Project drain is inact")
    expect(screen).toContain("[start]")
    expect(screen).not.toContain("Connect RedSkills")
    expect(screen).not.toContain("disabled")
    expect(screen).not.toContain("Host")

    await app.close()
  } finally {
    if (!app.setup.renderer.isDestroyed) app.setup.renderer.destroy()
  }
}, 15_000)
