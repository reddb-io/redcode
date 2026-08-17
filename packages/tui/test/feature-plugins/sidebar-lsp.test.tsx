/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import sidebarLsp from "../../src/feature-plugins/sidebar/lsp"
import { createTuiPluginApi } from "../fixture/tui-plugin"

const pluginMeta = {
  id: "sidebar-lsp",
  source: "internal",
  spec: "sidebar-lsp",
  target: "sidebar-lsp",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

test("omitted LSP configuration reports activation on file reads", async () => {
  const app = await renderSidebar()

  try {
    expect(app.captureCharFrame()).toContain("LSPs will activate as files are read")
    expect(app.captureCharFrame()).not.toContain("LSPs are disabled")
  } finally {
    app.renderer.destroy()
  }
})

test("initialization errors are distinct from waiting for file activation", async () => {
  const app = await renderSidebar("error")

  try {
    expect(app.captureCharFrame()).toContain("typescript . (failed)")
    expect(app.captureCharFrame()).not.toContain("LSPs will activate as files are read")
  } finally {
    app.renderer.destroy()
  }
})

async function renderSidebar(status?: "error") {
  let render: (() => JSX.Element) | undefined
  const base = createTuiPluginApi()
  const api = {
    ...base,
    state: {
      ...base.state,
      config: { lsp: undefined },
      lsp: () => (status ? [{ id: "typescript", root: ".", status }] : []),
    },
    slots: {
      register(input) {
        render = input.slots.sidebar_content as () => JSX.Element
        return "sidebar-lsp"
      },
    },
  } as TuiPluginApi

  await sidebarLsp.tui(api, undefined, pluginMeta)
  if (!render) throw new Error("sidebar LSP slot was not registered")
  const app = await testRender(render, { width: 60, height: 5 })
  await app.renderOnce()
  return app
}
