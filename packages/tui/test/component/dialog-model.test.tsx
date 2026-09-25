/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { DialogModel } from "../../src/component/dialog-model"
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
    onMount(() => dialog.replace(() => <DialogModel />))
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

const base = {
  capabilities: { protocol: "language", tools: true, input: ["text"], output: ["text"] },
  limit: { context: 1000, output: 100 },
  cost: { input: 1, output: 1 },
  release_date: "2026-01-01",
  status: "active",
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
      ...base,
      id: "codex/sol",
      providerID: "red-router",
      name: "Sol",
      upstream: { id: "codex", slug: "codex", name: "Codex", subscription: true },
      aliases: ["cx/sol"],
      modes: ["review"],
      variants: { low: {}, high: {} },
      routerVariants: [{ id: "codex/sol-high", level: "high", aliases: ["cx/sol-high"] }],
    },
    smart: {
      ...base,
      id: "smart",
      providerID: "red-router",
      name: "Smart",
      upstream: { id: "combo", name: "Combo", category: "combo" },
    },
  },
}

const codex = {
  id: "codex",
  name: "Codex",
  env: [],
  options: {},
  source: "config",
  models: { sol: { ...base, id: "sol", providerID: "codex", name: "Sol" } },
}

test("the model picker labels routed and direct models and follows renamed favorites", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const file = `${tmp.path}/model.json`
  await Bun.write(
    file,
    JSON.stringify({
      favorite: [{ providerID: "red-router", modelID: "cx/sol" }],
      recent: [{ providerID: "red-router", modelID: "cx/sol-high" }],
      variant: {},
    }),
  )
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return new Response("", { status: 404 })
      if (url.pathname === "/config/providers")
        return json({ providers: [router, codex], default: { "red-router": "smart", codex: "sol" } })
    },
    tmp.path,
    () => <Dialogs />,
    { width: 100, height: 40 },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Favorites"))
    const frame = setup.app.captureCharFrame()
    // The favorite saved under the old id shows as the renamed model. Its route shows as a title
    // suffix (it is also served directly), so the description does not repeat it.
    expect(frame).toContain("Sol · via RedRouter")
    expect(frame).toContain("Codex · subscription · also direct")
    expect(frame).toContain("review")
    expect(frame).toContain("RedRouter · Combo")
    expect(frame).toContain("Smart via RedRouter · Combo")
    // The direct connection's Sol is also served via RedRouter, so it gets a route suffix too.
    expect(frame).toContain("Sol · direct")
    expect(frame).toContain("also via RedRouter")

    await eventually(async () => {
      const saved = await Bun.file(file).json()
      return saved.favorite?.[0]?.modelID === "codex/sol"
    })
    expect(await Bun.file(file).json()).toEqual({
      favorite: [{ providerID: "red-router", modelID: "codex/sol" }],
      recent: [{ providerID: "red-router", modelID: "codex/sol" }],
      variant: { "red-router/codex/sol": "high" },
    })
  } finally {
    setup.app.renderer.destroy()
  }
})

const opusRouter = {
  id: "red-router",
  name: "RedRouter",
  env: [],
  options: {},
  source: "config",
  router: { kind: "red-router" },
  models: {
    "anthropic/opus": {
      ...base,
      id: "anthropic/opus",
      providerID: "red-router",
      name: "Claude Opus 5.5",
      upstream: { id: "anthropic", slug: "anthropic", name: "Claude Code" },
    },
    // Served through a remote RedRouter this connection forwards to: same name, different chain.
    "openrouter/anthropic/opus": {
      ...base,
      id: "openrouter/anthropic/opus",
      providerID: "red-router",
      name: "Claude Opus 5.5",
      upstream: { id: "openrouter-anthropic", slug: "openrouter-anthropic", name: "Claude" },
      via: "RedRouter",
    },
  },
}

test("two same-named models reached through different router chains show distinct route labels", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return new Response("", { status: 404 })
      if (url.pathname === "/config/providers")
        return json({ providers: [opusRouter], default: { "red-router": "anthropic/opus" } })
    },
    tmp.path,
    () => <Dialogs />,
    { width: 100, height: 40 },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Select model"))
    await setup.app.mockInput.typeText("opus")
    await wait(() => setup.app.captureCharFrame().includes("via RedRouter → RedRouter"))
    const frame = setup.app.captureCharFrame()
    // Same title, distinguishable routes: one served directly via RedRouter, one via a remote one.
    expect(frame).toContain("Claude Opus 5.5 · via RedRouter → RedRouter")
    expect(frame).toContain("Claude Opus 5.5 · via RedRouter")
  } finally {
    setup.app.renderer.destroy()
  }
})

async function eventually(fn: () => Promise<boolean>, timeout = 10_000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
