/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { TuiKeybind } from "../src/config/keybind"
import {
  bindsAltReturn,
  distinctShiftReturn,
  steerKeyActive,
  steerKeyIntent,
  steerKeyRejects,
} from "../src/prompt/steer"
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
    let shiftReturnReported = false
    const offShiftReturn = keymap.intercept("key", ({ event }) => {
      if (distinctShiftReturn(event)) shiftReturnReported = true
    })
    onCleanup(() => {
      offShiftReturn()
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
            // Mirrors the prompt's steer layer: always on, the intent judged per press, and a bare
            // ESC CR rejected so it falls through to the newline until the terminal has shown its
            // Shift+Enter is something else.
            offSteer = keymap.registerLayer({
              target: r,
              priority: 1,
              enabled: () => steerKeyActive({ focused: true, disabled: false }),
              commands: [
                {
                  name: "input.steer",
                  run: (ctx) => {
                    const escCr = {
                      shiftReturnReported,
                      newlineOnAltReturn: bindsAltReturn(config.keybinds.get("input.newline")),
                    }
                    if (steerKeyRejects(ctx.event, escCr)) return false
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

test("a bare ESC CR stays a newline whether busy or idle", async () => {
  // Legacy alt+return and a Shift+Enter mapped to ESC CR (VS Code sendSequence, Alacritty chars,
  // tmux) send the same two bytes, so they cannot steer or submit.
  for (const busy of [true, false]) {
    for (const kittyKeyboard of [false, true]) {
      const { app, calls, text } = await mountSteer({ busy, kittyKeyboard })
      try {
        app.renderer.stdin.emit("data", Buffer.from("\x1b\r"))
        expect(calls).toEqual([])
        expect(text()).toBe("\ndraft")
      } finally {
        app.renderer.destroy()
      }
    }
  }
})

// What terminals send for Enter and its modified forms once OpenTUI has asked for kitty flags and
// modifyOtherKeys (`CSI > 4;1 m`). WezTerm with its defaults answers modifyOtherKeys: Shift+Enter
// is `CSI 27;2;13~` and Alt+Enter a bare ESC CR (bound to fullscreen until unbound).
const enterReports = [
  { name: "legacy return (CR)", bytes: "\r", idle: "submit", busy: "submit" },
  { name: "shift+return, modifyOtherKeys (CSI 27;2;13~)", bytes: "\x1b[27;2;13~", idle: "newline", busy: "newline" },
  { name: "shift+return, kitty (CSI 13;2u)", bytes: "\x1b[13;2u", idle: "newline", busy: "newline" },
  { name: "ctrl+return, modifyOtherKeys (CSI 27;5;13~)", bytes: "\x1b[27;5;13~", idle: "newline", busy: "newline" },
  { name: "ctrl+j (LF)", bytes: "\n", idle: "newline", busy: "newline" },
  { name: "legacy alt+return or mapped shift+return (ESC CR)", bytes: "\x1b\r", idle: "newline", busy: "newline" },
  { name: "alt+return, kitty (CSI 13;3u)", bytes: "\x1b[13;3u", idle: "submit:steer-key", busy: "steer" },
  {
    name: "alt+return, modifyOtherKeys (CSI 27;3;13~)",
    bytes: "\x1b[27;3;13~",
    idle: "submit:steer-key",
    busy: "steer",
  },
] as const

for (const report of enterReports) {
  for (const busy of [false, true]) {
    const expected = busy ? report.busy : report.idle
    test(`${report.name} ${busy ? "while busy" : "while idle"}: ${expected}`, async () => {
      const { app, calls, text } = await mountSteer({ busy, kittyKeyboard: report.bytes.endsWith("u") })
      try {
        app.renderer.stdin.emit("data", Buffer.from(report.bytes))
        if (expected === "newline") {
          expect(calls).toEqual([])
          expect(text()).toBe("\ndraft")
          return
        }
        expect(calls).toEqual([expected])
        expect(text()).toBe("draft")
      } finally {
        app.renderer.destroy()
      }
    })
  }
}

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

test("ESC CR split across two reads still arrives as one alt+return", async () => {
  // OpenTUI holds a lone ESC briefly for the rest of its sequence, so a meta prefix and its CR that
  // land in separate reads are joined instead of turning into Escape then Enter.
  const { app, calls, text } = await mountSteer({ busy: true, keybinds: { input_newline: "shift+return,ctrl+j" } })
  try {
    app.renderer.stdin.emit("data", Buffer.from("\x1b"))
    app.renderer.stdin.emit("data", Buffer.from("\r"))
    await Bun.sleep(40)
    expect(calls).toEqual(["steer"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})

test("once the terminal has reported shift+return on its own, ESC CR is alt+return and steers", async () => {
  // zellij without the kitty protocol, tmux and legacy terminals send ESC CR for Alt+Enter. A
  // terminal that sent Shift+Enter as CSI 13;2u cannot also be mapping Shift+Enter to ESC CR.
  for (const shiftReturn of ["\x1b[13;2u", "\x1b[27;2;13~"]) {
    for (const busy of [true, false]) {
      const { app, calls, text } = await mountSteer({ busy, kittyKeyboard: shiftReturn.endsWith("u") })
      try {
        app.renderer.stdin.emit("data", Buffer.from("\x1b\r"))
        expect(calls).toEqual([])
        expect(text()).toBe("\ndraft")
        app.renderer.stdin.emit("data", Buffer.from(shiftReturn))
        expect(text()).toBe("\n\ndraft")
        app.renderer.stdin.emit("data", Buffer.from("\x1b\r"))
        expect(calls).toEqual([busy ? "steer" : "submit:steer-key"])
        expect(text()).toBe("\n\ndraft")
      } finally {
        app.renderer.destroy()
      }
    }
  }
})

test("a config that keeps alt+return off input_newline makes ESC CR steer from the first press", async () => {
  const { app, calls, text } = await mountSteer({
    busy: true,
    kittyKeyboard: false,
    keybinds: { input_newline: "shift+return,ctrl+j" },
  })
  try {
    app.renderer.stdin.emit("data", Buffer.from("\x1b\r"))
    expect(calls).toEqual(["steer"])
    expect(text()).toBe("draft")
  } finally {
    app.renderer.destroy()
  }
})

// Every encoding of Shift+Enter a terminal or multiplexer may send, including kitty reports that
// carry an event type and a report split across two reads.
const shiftReturnReports = [
  ["kitty (CSI 13;2u)", ["\x1b[13;2u"]],
  ["kitty press event (CSI 13;2:1u)", ["\x1b[13;2:1u"]],
  ["kitty with Caps Lock on (CSI 13;66u)", ["\x1b[13;66u"]],
  ["modifyOtherKeys (CSI 27;2;13~)", ["\x1b[27;2;13~"]],
  ["kitty, split after ESC", ["\x1b", "[13;2u"]],
  ["ctrl+return, kitty (CSI 13;5u)", ["\x1b[13;5u"]],
  ["ctrl+j (LF)", ["\n"]],
] as const

for (const [name, chunks] of shiftReturnReports) {
  for (const busy of [false, true]) {
    test(`${name} ${busy ? "while busy" : "while idle"}: newline`, async () => {
      const { app, calls, text } = await mountSteer({ busy })
      try {
        for (const chunk of chunks) app.renderer.stdin.emit("data", Buffer.from(chunk))
        await Bun.sleep(40)
        expect(calls).toEqual([])
        expect(text()).toBe("\ndraft")
      } finally {
        app.renderer.destroy()
      }
    })
  }
}
