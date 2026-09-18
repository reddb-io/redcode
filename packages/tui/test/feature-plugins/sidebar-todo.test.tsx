/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta } from "@reddb-io/redcode-plugin/tui"
import sidebarTodo from "../../src/feature-plugins/sidebar/todo"
import { ThemeProvider } from "../../src/context/theme"
import { KVProvider } from "../../src/context/kv"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createTuiPluginApi } from "../fixture/tui-plugin"

const pluginMeta = {
  id: "sidebar-todo",
  source: "internal",
  spec: "sidebar-todo",
  target: "sidebar-todo",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

const bright = RGBA.fromInts(250, 250, 250)
const muted = RGBA.fromInts(120, 120, 120)

async function renderSidebar(todos: unknown[]) {
  let render: (() => JSX.Element) | undefined
  const base = createTuiPluginApi()
  const api = {
    ...base,
    theme: { current: new Proxy({}, { get: (_, key) => (key === "text" ? bright : muted) }) },
    state: {
      ...base.state,
      session: { get: () => undefined, todo: () => todos },
    },
    slots: {
      register(input: Parameters<TuiPluginApi["slots"]["register"]>[0]) {
        const slot = input.slots.sidebar_content as (ctx: unknown, props: { session_id: string }) => JSX.Element
        // TodoItem reads the theme context, which needs the config and KV providers beneath it.
        render = () => (
          <TestTuiContexts directory="/tmp/redcode-tui-todo-test">
            <TuiConfigProvider config={createTuiResolvedConfig()}>
              <KVProvider>
                <ThemeProvider mode="dark">{slot({}, { session_id: "s" })}</ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </TestTuiContexts>
        )
        return "sidebar-todo"
      },
    },
  } as unknown as TuiPluginApi

  await sidebarTodo.tui(api, undefined, pluginMeta)
  if (!render) throw new Error("sidebar todo slot was not registered")
  const app = await testRender(render, { width: 36, height: 16 })
  await app.renderOnce()
  // The theme loads asynchronously: the panel mounts once the provider reports ready.
  for (let i = 0; i < 50 && app.captureCharFrame().trim().length === 0; i++) {
    await Bun.sleep(10)
    await app.renderOnce()
  }
  return app
}

test("the panel shows open tasks and only closed ones from the last 15 minutes", async () => {
  const now = Date.now()
  const app = await renderSidebar([
    { content: "Open task", status: "pending" },
    { content: "Freshly done", status: "completed", closedAt: now - 60_000 },
    { content: "Old done", status: "completed", closedAt: now - 30 * 60_000 },
    { content: "Legacy done", status: "completed" },
  ])
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Open task")
    expect(frame).toContain("Freshly done")
    expect(frame).not.toContain("Old done")
    expect(frame).not.toContain("Legacy done")
  } finally {
    app.renderer.destroy()
  }
})

test("a thread with only stale closed tasks hides the panel", async () => {
  const now = Date.now()
  const app = await renderSidebar([
    { content: "Old done", status: "completed", closedAt: now - 30 * 60_000 },
    { content: "Legacy done", status: "cancelled" },
  ])
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("Old done")
    expect(frame).not.toContain("Legacy done")
    expect(frame).not.toContain("Todo")
  } finally {
    app.renderer.destroy()
  }
})
