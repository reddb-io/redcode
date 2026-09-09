/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { DialogMcp } from "../../src/component/dialog-mcp"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait, json, directory } from "../cli/cmd/tui/sync-fixture"
import type { McpStatus } from "@reddb-io/redcode-sdk/v2"

function Dialogs() {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogMcp />))
    return null
  }
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ClipboardProvider>
            <ToastProvider>
              <DialogProvider>
                <Open />
              </DialogProvider>
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

test("MCP dialog reloads the selected server, refreshes resources and blocks duplicate actions", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const gate = Promise.withResolvers<Response>()
  const requests: string[] = []
  const reloads: unknown[] = []
  const states: Record<string, McpStatus> = { demo: { status: "connected" } }
  const setup = await mount(
    async (url, input) => {
      requests.push(url.pathname)
      if (url.pathname === "/mcp") return json(states)
      if (url.pathname === "/mcp/reload") {
        if (!(input instanceof Request)) throw new Error("Expected an SDK request")
        reloads.push(await input.json())
        return gate.promise
      }
      if (url.pathname === "/experimental/resource")
        return json({ "demo:test://new": { name: "New", uri: "test://new", client: "demo" } })
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    requests.length = 0
    setup.app.mockInput.pressKey("r", { ctrl: true })
    await wait(() => reloads.length === 1)
    setup.app.mockInput.pressEnter()
    setup.app.mockInput.pressKey(" ")
    expect(reloads).toEqual([{ name: "demo" }])
    gate.resolve(json(states))
    await wait(() => requests.includes("/experimental/resource"))
    expect(requests).not.toContain("/instance/dispose")
    expect(requests).not.toContain("/session")
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("Reload all MCPs")
  } finally {
    gate.resolve(json(states))
    setup.app.renderer.destroy()
  }
})

test("an empty MCP dialog can discover newly configured servers without restarting the session", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const reloads: unknown[] = []
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/mcp") return json({})
      if (url.pathname === "/mcp/reload") {
        if (!(input instanceof Request)) throw new Error("Expected an SDK request")
        reloads.push(await input.json())
        return json({ added: { status: "failed", error: "Server executable not found" } })
      }
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    const sessions = [...setup.sync.data.session]
    setup.app.mockInput.pressEnter()
    await wait(() => setup.sync.data.mcp.added?.status === "failed")
    expect(reloads).toEqual([{}])
    expect(setup.sync.data.session).toEqual(sessions)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("Server executable not found")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("reloading a removed server clears its status and resources from the dialog", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/mcp") return json({ removed: { status: "connected" } })
      if (url.pathname === "/mcp/reload") return json({})
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    setup.sync.set("mcp_resource", { old: { name: "Old", uri: "test://old", client: "removed" } })
    setup.app.mockInput.pressEnter()
    await wait(() => Object.keys(setup.sync.data.mcp).length === 0)
    await wait(() => Object.keys(setup.sync.data.mcp_resource).length === 0)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).not.toContain("removed")
    expect(setup.app.captureCharFrame()).toContain("Reload all MCPs")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("MCP change notifications refresh the catalog without reloading session state", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const states: Record<string, McpStatus> = {}
  const calls: string[] = []
  const setup = await mount((url) => {
    calls.push(url.pathname)
    if (url.pathname === "/mcp") return json(states)
  }, tmp.path)
  try {
    calls.length = 0
    states.demo = { status: "connected" }
    setup.emit({
      directory,
      payload: { id: "evt_mcp_reload", type: "mcp.tools.changed", properties: { server: "demo" } },
    })
    await wait(() => setup.sync.data.mcp.demo?.status === "connected")
    expect(calls).toContain("/experimental/resource")
    expect(calls).not.toContain("/session")
    expect(calls).not.toContain("/instance/dispose")
  } finally {
    setup.app.renderer.destroy()
  }
})
