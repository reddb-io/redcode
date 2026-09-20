/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { InputRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { createDialogSetupState, DialogSetup } from "../../src/component/dialog-setup"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function Dialogs() {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    const state = createDialogSetupState({ settings: intelligence.settings, step: "principal" })
    onMount(() =>
      dialog.replace(() => <DialogSetup state={state} onModelSelected={() => {}} />),
    )
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

const provider = {
  id: "mock",
  name: "Mock Provider",
  env: [],
  options: {},
  source: "config",
  models: {
    model: {
      id: "model",
      providerID: "mock",
      name: "Mock Model",
      capabilities: { protocol: "language", tools: true, input: ["text"], output: ["text"] },
      limit: { context: 1000, output: 100 },
      cost: {},
    },
  },
}

const intelligence = {
  settings: { enabled: false, onboarding: "pending" } as Intelligence.Settings,
  environment: "/global",
}

test("global setup selects System Two models and offers provider connection in the same flow", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("Mock Model")
    expect(principal).toContain("Connect another provider…")

    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System Two transformations"))
    await setup.app.renderOnce()
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System One connection"))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("global setup can open provider connection when no generative model is connected", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => (url.pathname === "/api/intelligence" ? json(intelligence) : undefined),
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await wait(() => setup.app.captureCharFrame().includes("Connect another provider…"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
  } finally {
    setup.app.renderer.destroy()
  }
})
