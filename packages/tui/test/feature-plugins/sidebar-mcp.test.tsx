/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiSidebarMcpItem } from "@reddb-io/redcode-plugin/tui"
import sidebarMcp from "../../src/feature-plugins/sidebar/mcp"
import { createTuiPluginApi } from "../fixture/tui-plugin"

const pluginMeta = {
  id: "sidebar-mcp",
  source: "internal",
  spec: "sidebar-mcp",
  target: "sidebar-mcp",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

test("a server that needs auth is clickable and opens the sign-in flow", async () => {
  const opened: Array<() => JSX.Element> = []
  const { app } = await renderSidebar(
    [
      { name: "docs", status: "connected" },
      { name: "linear", status: "needs_auth" },
    ],
    opened,
  )
  try {
    const lines = app.captureCharFrame().split("\n")
    expect(lines.join("\n")).toContain("linear Needs auth · sign in")

    const connectedRow = lines.findIndex((line) => line.includes("docs"))
    await app.mockMouse.click(4, connectedRow)
    expect(opened).toHaveLength(0)

    const authRow = lines.findIndex((line) => line.includes("linear"))
    await app.mockMouse.click(4, authRow)
    expect(opened).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})

async function renderSidebar(items: TuiSidebarMcpItem[], opened: Array<() => JSX.Element>) {
  let render: (() => JSX.Element) | undefined
  const base = createTuiPluginApi()
  const api = {
    ...base,
    state: { ...base.state, mcp: () => items },
    ui: {
      ...base.ui,
      dialog: { ...base.ui.dialog, replace: (element: () => JSX.Element) => void opened.push(element) },
    },
    slots: {
      register(input: Parameters<TuiPluginApi["slots"]["register"]>[0]) {
        render = input.slots.sidebar_project as () => JSX.Element
        return "sidebar-mcp"
      },
    },
  } as TuiPluginApi

  await sidebarMcp.tui(api, undefined, pluginMeta)
  if (!render) throw new Error("sidebar MCP slot was not registered")
  const app = await testRender(render, { width: 60, height: 5 })
  await app.renderOnce()
  return { app }
}
