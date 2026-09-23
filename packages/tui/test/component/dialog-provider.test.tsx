/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { json, mount, wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const { DialogProvider: DialogProviderConnect } = await import("../../src/component/dialog-provider")

function Dialogs() {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogProviderConnect />))
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
              <Toast />
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

test("a connected provider can replace its saved API key", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const saved: unknown[] = []
  const provider = {
    id: "mock",
    name: "Mock Provider",
    env: [],
    options: {},
    source: "config",
    models: {},
  }
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/provider") return json({ all: [provider], default: {}, connected: [provider.id] })
      if (url.pathname === "/provider/auth") return json({ [provider.id]: [{ type: "api", label: "API key" }] })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: {} })
      if (url.pathname === `/auth/${provider.id}`) {
        if (!(input instanceof Request)) throw new Error("Expected an HTTP request")
        saved.push(await input.json())
        return json(true)
      }
      if (url.pathname === "/instance/dispose") return json(true)
      return undefined
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    setup.app.mockInput.pressEnter()
    await setup.app.renderOnce()
    await wait(() => setup.app.captureCharFrame().includes("Manage Mock Provider"))
    expect(setup.app.captureCharFrame()).toContain("Replace API key or login")

    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressEnter()
    await setup.app.renderOnce()
    await wait(
      () =>
        setup.app.captureCharFrame().includes("API key") &&
        setup.app.renderer.currentFocusedEditor instanceof TextareaRenderable,
    )
    const textarea = setup.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("API key input is not focused")
    textarea.setText("replacement-key")
    setup.app.mockInput.pressEnter()
    await setup.app.renderOnce()

    await wait(() => saved.length === 1)
    expect(saved).toEqual([{ type: "api", key: "replacement-key" }])
  } finally {
    setup.app.renderer.destroy()
  }
})

test("provider reload failure stays in the credential dialog without exiting the TUI", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const exits: unknown[] = []
  let disposed = false
  const provider = {
    id: "mock",
    name: "Mock Provider",
    env: [],
    options: {},
    source: "config",
    models: {},
  }
  const setup = await mount(
    async (url) => {
      if (url.pathname === "/provider") return json({ all: [provider], default: {}, connected: [provider.id] })
      if (url.pathname === "/provider/auth") return json({ [provider.id]: [{ type: "api", label: "API key" }] })
      if (url.pathname === "/config/providers") {
        if (disposed) throw new Error("provider reload unavailable")
        return json({ providers: [provider], default: {} })
      }
      if (url.pathname === `/auth/${provider.id}`) return json(true)
      if (url.pathname === "/instance/dispose") {
        disposed = true
        return json(true)
      }
    },
    tmp.path,
    () => <Dialogs />,
    {
      exit: (error) => exits.push(error),
      timing: { retryMs: [], recoveryLimit: 0, settleMs: 0 },
    },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Manage Mock Provider"))
    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = setup.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("API key input is not focused")
    textarea.setText("replacement-key")
    setup.app.mockInput.pressEnter()

    await wait(() => disposed && setup.app.captureCharFrame().includes("Failed to save credential"), 5000)
    expect(setup.app.captureCharFrame()).toContain("API key")
    expect(exits).toEqual([])
  } finally {
    setup.app.renderer.destroy()
  }
})

async function mountRemoval(
  tmp: string,
  removed: { credential: boolean; config: boolean; references: string[]; learnedLimits: number },
  notes: { envVariables: string[]; referencingFiles: string[] } = { envVariables: [], referencingFiles: [] },
) {
  await Bun.write(`${tmp}/kv.json`, "{}")
  const removals: (string | null)[] = []
  const provider = {
    id: "mock",
    name: "Mock Provider",
    env: [],
    options: {},
    source: "config",
    models: {},
  }
  const gone = () => removals.includes("false")
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/provider")
        return json({ all: [provider], default: {}, connected: gone() ? [] : [provider.id] })
      if (url.pathname === "/provider/auth") return json({ [provider.id]: [{ type: "api", label: "API key" }] })
      if (url.pathname === "/config/providers") return json({ providers: gone() ? [] : [provider], default: {} })
      if (url.pathname === `/provider/${provider.id}`) {
        if (!(input instanceof Request) || input.method !== "DELETE") throw new Error("Expected a DELETE request")
        const dryRun = url.searchParams.get("dryRun")
        removals.push(dryRun)
        return json({
          providerID: provider.id,
          dryRun: dryRun === "true",
          removed,
          configPath: `${tmp}/redcode.json`,
          ...notes,
        })
      }
      return undefined
    },
    tmp,
    () => <Dialogs />,
  )
  return { setup, removals }
}

test("the manage menu removes a connected provider after previewing what goes", async () => {
  await using tmp = await tmpdir()
  const { setup, removals } = await mountRemoval(tmp.path, {
    credential: true,
    config: true,
    references: ["default model"],
    learnedLimits: 2,
  })
  try {
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Manage Mock Provider"))
    expect(setup.app.captureCharFrame()).toContain("Remove provider")

    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Remove Mock Provider?"))
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("Removes: saved key or login")
    expect(frame).toContain("In use by: default model.")
    expect(removals).toEqual(["true"])

    setup.app.mockInput.pressEnter()
    await wait(() => removals.length === 2)
    expect(removals).toEqual(["true", "false"])
    await wait(() => setup.app.captureCharFrame().includes("Mock Provider removed."))
    expect(setup.sync.data.provider_next.connected).toEqual([])
  } finally {
    setup.app.renderer.destroy()
  }
})

test("ctrl+d on a connected provider previews the removal and cancelling keeps it", async () => {
  await using tmp = await tmpdir()
  const { setup, removals } = await mountRemoval(
    tmp.path,
    { credential: true, config: false, references: [], learnedLimits: 0 },
    { envVariables: ["MOCK_API_KEY"], referencingFiles: ["/work/redcode.json"] },
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    setup.app.mockInput.pressKey("d", { ctrl: true })
    await wait(() => setup.app.captureCharFrame().includes("Remove Mock Provider?"))
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("MOCK_API_KEY")
    expect(frame).toContain("Still mentioned in:")

    setup.app.mockInput.pressArrow("left")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    expect(removals).toEqual(["true"])
    expect(setup.sync.data.provider_next.connected).toEqual(["mock"])
  } finally {
    setup.app.renderer.destroy()
  }
})
