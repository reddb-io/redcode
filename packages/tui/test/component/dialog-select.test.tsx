/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { InputRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, onCleanup, onMount } from "solid-js"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { DialogSelect } from "../../src/ui/dialog-select"
import { ToastProvider } from "../../src/ui/toast"
import { mount, wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function Picker(props: { current: () => string; moved: string[]; selected: string[] }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() =>
      dialog.replace(() => (
        <DialogSelect
          title="Pick a letter"
          current={props.current()}
          options={["a", "b", "c"].map((value) => ({ title: `Letter ${value.toUpperCase()}`, value }))}
          onMove={(option) => props.moved.push(option.value)}
          onSelect={(option) => props.selected.push(option.value)}
        />
      )),
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

// The picker defers its move to `current` with a zero-delay timer; a timer scheduled after it fires after it.
const afterDeferredMove = () => new Promise((resolve) => setTimeout(resolve, 0))

test("a superseded current value never moves the cursor after a newer one", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const [current, setCurrent] = createSignal("a")
  const moved: string[] = []
  const selected: string[] = []
  const setup = await mount(undefined, tmp.path, () => (
    <Picker current={current} moved={moved} selected={selected} />
  ))
  try {
    await ready(setup.app)
    const before = moved.length
    // A list that finishes loading changes `current` twice in quick succession.
    setCurrent("b")
    setCurrent("c")
    await afterDeferredMove()
    expect(moved.slice(before)).toEqual(["c"])
    setup.app.mockInput.pressEnter()
    await wait(() => selected.length === 1)
    expect(selected).toEqual(["c"])
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a key press right after current changes is not undone by the deferred move", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const [current, setCurrent] = createSignal("a")
  const moved: string[] = []
  const selected: string[] = []
  const setup = await mount(undefined, tmp.path, () => (
    <Picker current={current} moved={moved} selected={selected} />
  ))
  try {
    await ready(setup.app)
    setCurrent("b")
    setup.app.mockInput.pressArrow("down")
    await afterDeferredMove()
    setup.app.mockInput.pressEnter()
    await wait(() => selected.length === 1)
    expect(selected).toEqual(["c"])
  } finally {
    setup.app.renderer.destroy()
  }
})

async function ready(app: Awaited<ReturnType<typeof mount>>["app"]) {
  await wait(() => app.captureCharFrame().includes("Letter C"))
  await wait(
    () =>
      app.renderer.currentFocusedRenderable instanceof InputRenderable &&
      !app.renderer.currentFocusedRenderable.isDestroyed,
  )
}
