/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { DialogVariant } from "../../src/component/dialog-variant"
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

function Dialogs() {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogVariant />))
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

const router = {
  id: "red-router",
  name: "RedRouter",
  env: [],
  options: {},
  source: "config",
  router: { kind: "red-router" },
  models: {
    "codex/sol": {
      id: "codex/sol",
      providerID: "red-router",
      api: { id: "codex/sol", url: "", npm: "@ai-sdk/openai-compatible" },
      name: "Sol",
      capabilities: { protocol: "language", tools: true, input: ["text"], output: ["text"] },
      limit: { context: 1000, output: 100 },
      cost: { input: 1, output: 1 },
      release_date: "2026-01-01",
      status: "active",
      modes: ["review"],
      variants: { low: {}, high: {}, review: {} },
      routerVariants: [{ id: "codex/sol-review", mode: "review" }],
    },
  },
}

test("the variant picker offers a router's review mode with the id it requests", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  await Bun.write(
    `${tmp.path}/model.json`,
    JSON.stringify({ recent: [{ providerID: "red-router", modelID: "codex/sol" }], favorite: [], variant: {} }),
  )
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return new Response("", { status: 404 })
      if (url.pathname === "/config/providers")
        return json({ providers: [router], default: { "red-router": "codex/sol" } })
    },
    tmp.path,
    () => <Dialogs />,
    { width: 100, height: 30 },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("review"))
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("Select variant")
    expect(frame).toContain("high")
    expect(frame).toContain("mode · codex/sol-review")
  } finally {
    setup.app.renderer.destroy()
  }
})
