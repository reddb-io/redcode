/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { TuiKeybind } from "../../../src/config/keybind"
import { TestTuiContexts } from "../../fixture/tui-environment"
import type { ClipboardService } from "../../../src/context/clipboard"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPrompt(input: {
  root: string
  keybinds: Partial<TuiKeybind.Keybinds>
  onConfirm: (value: string) => void
  clipboard?: ClipboardService
  busy?: boolean
}) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })

  const [{ DialogProvider }, { DialogPrompt }, { ThemeProvider }, { ConfigProvider }, { ToastProvider }, { Keymap }] =
    await Promise.all([
      import("../../../src/ui/dialog"),
      import("../../../src/ui/dialog-prompt"),
      import("../../../src/context/theme"),
      import("../../../src/config"),
      import("../../../src/ui/toast"),
      import("../../../src/context/keymap"),
    ])

  function Harness() {
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader: { timeout: 1000 },
    })

    function Prompt() {
      onCleanup(Keymap.use().mode.push("modal"))
      return <DialogPrompt title="Rename Session" value="draft" busy={input.busy} onConfirm={input.onConfirm} />
    }

    return (
      <TestTuiContexts
        clipboard={input.clipboard}
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <ConfigProvider config={resolvedConfig}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Prompt />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  app.renderer.start()
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test.each([
  { name: "Ctrl+V", key: "v", modifiers: { ctrl: true } },
  { name: "Ctrl+Shift+V", key: "v", modifiers: { ctrl: true, shift: true } },
  { name: "Alt+V", key: "v", modifiers: { meta: true } },
  { name: "Shift+Insert", key: "\x1b[2~", modifiers: { shift: true } },
])("dialog fields paste clipboard text on $name without submitting", async ({ key, modifiers }) => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm: (value) => confirmed.push(value),
    clipboard: { read: async () => ({ mime: "text/plain", data: "key-ação-世界\r\n" }), write: async () => {} },
  })
  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor!
    prompt.app.mockInput.pressKey(key, modifiers)
    await wait(() => textarea.plainText === "draftkey-ação-世界")
    expect(confirmed).toEqual([])
    prompt.app.mockInput.pressEnter()
    expect(confirmed).toEqual(["draftkey-ação-世界"])
  } finally {
    await prompt.cleanup()
  }
})

test("dialog paste avoids duplication when the terminal also pastes and allows a second key paste", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm() {},
    clipboard: { read: async () => ({ mime: "text/plain", data: "pasted" }), write: async () => {} },
  })
  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor!
    prompt.app.mockInput.pressKey("v", { ctrl: true })
    await wait(() => textarea.plainText === "draftpasted")
    await prompt.app.mockInput.pasteBracketedText("pasted")
    expect(textarea.plainText).toBe("draftpasted")
    prompt.app.mockInput.pressKey("v", { ctrl: true })
    await wait(() => textarea.plainText === "draftpastedpasted")
  } finally {
    await prompt.cleanup()
  }
})

test("a pending clipboard read cannot paste into a dialog after it closes", async () => {
  await using tmp = await tmpdir()
  const pending = Promise.withResolvers<{ mime: string; data: string }>()
  let reads = 0
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm() {},
    clipboard: {
      read: () => {
        reads++
        return pending.promise
      },
      write: async () => {},
    },
  })
  await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  prompt.app.mockInput.pressKey("v", { ctrl: true })
  await wait(() => reads === 1)
  await prompt.cleanup()
  pending.resolve({ mime: "text/plain", data: "stale" })
  await Bun.sleep(10)
})

test("right-click pastes into a dialog field", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm() {},
    clipboard: { read: async () => ({ mime: "text/plain", data: "mouse" }), write: async () => {} },
  })
  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await prompt.app.renderOnce()
    const textarea = prompt.app.renderer.currentFocusedEditor!
    await prompt.app.mockMouse.click(textarea.x + 1, textarea.y, 2)
    await wait(() => textarea.plainText === "draftmouse")
  } finally {
    await prompt.cleanup()
  }
})

test("a legacy terminal's raw Ctrl+V byte pastes into a provider field", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm() {},
    clipboard: { read: async () => ({ mime: "text/plain", data: "legacy-key" }), write: async () => {} },
  })
  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await prompt.app.mockInput.pressKeys(["\x16"])
    await wait(() => prompt.app.renderer.currentFocusedEditor?.plainText === "draftlegacy-key")
  } finally {
    await prompt.cleanup()
  }
})

test("dialog prompt submit wins when return is also input newline", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "super+return",
      "input.newline": "return,shift+return,alt+return,ctrl+j",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()

    expect(confirmed).toEqual(["draft"])
    expect(textarea.plainText).toBe("draft")
  } finally {
    await prompt.cleanup()
  }
})

test("alt return inserts a newline with default keybinds", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {},
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter({ meta: true })

    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft\n")
  } finally {
    await prompt.cleanup()
  }
})

test("dialog prompt submit can be rebound separately from input submit", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "return",
      "dialog.prompt.submit": "ctrl+y",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()
    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft")

    prompt.app.mockInput.pressKey("y", { ctrl: true })

    expect(confirmed).toEqual(["draft"])
  } finally {
    await prompt.cleanup()
  }
})

test("dialog prompt submit can be disabled", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const prompt = await mountPrompt({
    root: tmp.path,
    keybinds: {
      "input.submit": "return",
      "dialog.prompt.submit": "none",
    },
    onConfirm: (value) => confirmed.push(value),
  })

  try {
    await wait(() => prompt.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = prompt.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")

    prompt.app.mockInput.pressEnter()

    expect(confirmed).toEqual([])
    expect(textarea.plainText).toBe("draft")
  } finally {
    await prompt.cleanup()
  }
})
