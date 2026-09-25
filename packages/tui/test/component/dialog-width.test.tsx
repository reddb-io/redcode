/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { onCleanup, onMount, type JSX } from "solid-js"
import { DialogModel } from "../../src/component/dialog-model"
import { DialogProvider as DialogProviderConnect } from "../../src/component/dialog-provider"
import { ClipboardProvider } from "../../src/context/clipboard"
import { LocalProvider } from "../../src/context/local"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { json, mount, wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// The default (unsized) dialog width, from packages/tui/src/ui/dialog.tsx.
const DEFAULT_WIDTH = 60
// The size dialog-model.tsx and dialog-provider.tsx now request, from the same file.
const LARGE_WIDTH = 88

function Dialogs(props: { open: () => JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(props.open))
    return null
  }
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ClipboardProvider>
            <ToastProvider>
              <RouteProvider>
                <LocalProvider>
                  <DialogProvider>
                    <Open />
                  </DialogProvider>
                </LocalProvider>
              </RouteProvider>
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

/** Every rendered width in the tree, including the dialog panel's own box. */
function widths(node: Renderable): number[] {
  return [node.width, ...node.getChildren().flatMap((child) => widths(child))]
}

test("the model and provider dialogs open at least 30% wider than the default dialog size", async () => {
  expect(LARGE_WIDTH).toBeGreaterThanOrEqual(DEFAULT_WIDTH * 1.3)

  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return new Response("", { status: 404 })
      if (url.pathname === "/config/providers") return json({ providers: [], default: {} })
      if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    },
    tmp.path,
    () => <Dialogs open={() => <DialogModel />} />,
    { width: 150, height: 40 },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Select model"))
    // The dialog panel renders at the requested "large" width; the terminal is wide enough not to clamp it.
    expect(widths(setup.app.renderer.root)).toContain(LARGE_WIDTH)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("the model and provider dialogs stay within a narrow terminal", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const terminalWidth = 50
  const setup = await mount(
    (url) => {
      if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
      if (url.pathname === "/provider/auth") return json({})
      if (url.pathname === "/config/providers") return json({ providers: [], default: {} })
    },
    tmp.path,
    () => <Dialogs open={() => <DialogProviderConnect />} />,
    { width: terminalWidth, height: 40 },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    // maxWidth = dimensions().width - 2 clamps the panel below its requested "large" width.
    const found = widths(setup.app.renderer.root)
    expect(found).toContain(terminalWidth - 2)
    expect(found).not.toContain(LARGE_WIDTH)
  } finally {
    setup.app.renderer.destroy()
  }
})
