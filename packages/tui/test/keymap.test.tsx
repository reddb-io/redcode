/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { TuiKeybind } from "../src/config/keybind"
import { steerKeyActive, steerKeyIntent } from "../src/prompt/steer"
import { getOpencodeModeStack, OPENCODE_BASE_MODE, OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

test("legacy page key aliases compile as page keys", async () => {
  const sequences: Record<string, string[][]> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig({
      messages_page_up: "pgup",
      messages_page_down: "pgdown",
    })
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      bindings: config.keybinds.gather("session", ["session.page.up", "session.page.down"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["session.page.up", "session.page.down"],
    })
    sequences.up =
      bindings.get("session.page.up")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    sequences.down =
      bindings.get("session.page.down")?.map((binding) => binding.sequence.map((part) => part.stroke.name)) ?? []
    onCleanup(() => {
      offLayer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(sequences).toEqual({
      up: [["pageup"]],
      down: [["pagedown"]],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("mode-less bindings stay active when opencode mode changes", async () => {
  const counts: Record<string, Record<string, number>> = {}

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    const offGlobal = keymap.registerLayer({
      commands: [
        { name: "session.list", run() {} },
        { name: "session.new", run() {} },
        { name: "session.page.up", run() {} },
        { name: "session.first", run() {} },
      ],
      bindings: config.keybinds.gather("test.global", [
        "session.list",
        "session.new",
        "session.page.up",
        "session.first",
      ]),
    })
    const offBase = keymap.registerLayer({
      mode: OPENCODE_BASE_MODE,
      commands: [{ name: "model.list", run() {} }],
      bindings: config.keybinds.gather("test.base", ["model.list"]),
    })
    const activeCounts = () =>
      Object.fromEntries(
        Array.from(
          keymap.getCommandBindings({
            visibility: "active",
            commands: ["session.list", "session.new", "session.page.up", "session.first", "model.list"],
          }),
          ([command, bindings]) => [command, bindings.length],
        ),
      )

    counts.base = activeCounts()
    const popQuestion = getOpencodeModeStack(keymap).push("question")
    counts.question = activeCounts()
    popQuestion()
    const popAutocomplete = getOpencodeModeStack(keymap).push("autocomplete")
    counts.autocomplete = activeCounts()
    popAutocomplete()

    onCleanup(() => {
      offBase()
      offGlobal()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <box />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(counts).toEqual({
      base: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 1 },
      question: { "session.list": 1, "session.new": 1, "session.page.up": 2, "session.first": 2, "model.list": 0 },
      autocomplete: {
        "session.list": 1,
        "session.new": 1,
        "session.page.up": 2,
        "session.first": 2,
        "model.list": 0,
      },
    })
  } finally {
    app.renderer.destroy()
  }
})

async function mountSteer(input: {
  busy: boolean
  keybinds?: TuiKeybind.KeybindOverrides
  /** Legacy terminal: modifiers reach us as ESC-prefixed bytes instead of kitty key reports. */
  kittyKeyboard?: boolean
}) {
  const calls: string[] = []
  let textarea: TextareaRenderable | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig(input.keybinds)
    const offKeymap = registerOpencodeKeymap(keymap, renderer, config)
    let offSteer = () => {}
    onCleanup(() => {
      offSteer()
      offKeymap()
    })

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <textarea
          initialValue="draft"
          onSubmit={() => calls.push("submit")}
          ref={(r: TextareaRenderable) => {
            textarea = r
            r.focus()
            // Mirrors the prompt's steer layer: always on, the intent judged per press.
            offSteer = keymap.registerLayer({
              target: r,
              priority: 1,
              enabled: () => steerKeyActive({ focused: true, disabled: false }),
              commands: [
                {
                  name: "input.steer",
                  run: () => {
                    const intent = steerKeyIntent(input.busy ? "busy" : "idle")
                    calls.push(intent === "steer" ? "steer" : "submit:steer-key")
                  },
                },
              ],
              bindings: config.keybinds.gather("prompt.steer", ["input.steer"]),
            })
          }}
        />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: input.kittyKeyboard ?? true })
  await app.renderOnce()
  return { app, calls, text: () => textarea?.plainText }
}

test("while busy, alt+return steers and return still submits", async () => {
  const { app, calls, text } = await mountSteer({ busy: true })
  try {
    app.mockInput.pressEnter({ meta: true })
    app.mockInput.pressEnter()
    expect(calls).toEqual(["steer", "submit"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})

test("while idle, alt+return submits through the steer layer", async () => {
  const { app, calls, text } = await mountSteer({ busy: false })
  try {
    app.mockInput.pressEnter({ meta: true })
    expect(calls).toEqual(["submit:steer-key"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})

test("shift+return inserts a newline whether busy or idle", async () => {
  for (const busy of [true, false]) {
    const { app, calls, text } = await mountSteer({ busy })
    try {
      app.mockInput.pressEnter({ shift: true })
      expect(calls).toEqual([])
      expect(text()).toContain("\n")
    } finally {
      app.renderer.destroy()
    }
  }
})

test("a legacy terminal's ESC CR is alt+return and steers while busy", async () => {
  const { app, calls, text } = await mountSteer({ busy: true, kittyKeyboard: false })
  try {
    // Without the kitty protocol the mock sends alt as an ESC prefix, the way xterm-likes do.
    app.mockInput.pressEnter({ meta: true })
    expect(calls).toEqual(["steer"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})

test("an explicit input_newline on alt+return keeps its newline while busy", async () => {
  const { app, calls, text } = await mountSteer({ busy: true, keybinds: { input_newline: "alt+return,ctrl+j" } })
  try {
    app.mockInput.pressEnter({ meta: true })
    expect(calls).toEqual([])
    expect(text()).toContain("\n")
  } finally {
    app.renderer.destroy()
  }
})

test("an explicit input_steer on shift+return still steers while busy", async () => {
  // The old default, kept on purpose: explicit config wins over the newline default on the same key.
  const { app, calls, text } = await mountSteer({ busy: true, keybinds: { input_steer: "shift+return" } })
  try {
    app.mockInput.pressEnter({ shift: true })
    expect(calls).toEqual(["steer"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})
