import { describe, expect, test } from "bun:test"
import {
  busyHint,
  latestQueuedPrompt,
  parseSteerCommand,
  pendingAssistantIndex,
  pendingBadge,
  promptDelivery,
  steeredAt,
  steeredLabel,
  steerKeyActive,
  steerKeyAmbiguous,
  steerKeyIntent,
  altReturnUnreported,
  legacyAltReturn,
  stripSteerCommand,
} from "../../src/prompt/steer"
import { TuiKeybind } from "../../src/config/keybind"

describe("prompt delivery", () => {
  test("submit always sends queue and the steer key always sends steer", () => {
    expect(promptDelivery("submit")).toBe("queue")
    expect(promptDelivery("steer")).toBe("steer")
  })

  test("the steer key layer is live whenever the prompt takes input", () => {
    expect(steerKeyActive({ focused: true, disabled: false })).toBe(true)
    expect(steerKeyActive({ focused: false, disabled: false })).toBe(false)
    expect(steerKeyActive({ focused: true, disabled: true })).toBe(false)
  })

  test("a bare ESC CR is not a steer key press", () => {
    // Legacy alt+return and a Shift+Enter mapped to ESC CR send the same bytes.
    expect(legacyAltReturn({ raw: "\x1b\r", sequence: "\x1b\r", source: "raw" })).toBe(true)
    expect(legacyAltReturn({ sequence: "\x1b\r" })).toBe(true)
    // Reported unambiguously: kitty CSI 13;3u and modifyOtherKeys CSI 27;3;13~.
    expect(legacyAltReturn({ raw: "\x1b[13;3u", sequence: "\x1b[13;3u", source: "kitty" })).toBe(false)
    expect(legacyAltReturn({ raw: "\x1b[27;3;13~", sequence: "\x1b[27;3;13~", source: "raw" })).toBe(false)
    // Dispatched from the palette or a test, with no key event at all.
    expect(legacyAltReturn(undefined)).toBe(false)
  })

  test("the steer key steers while the session works and submits when idle", () => {
    expect(steerKeyIntent("busy")).toBe("steer")
    expect(steerKeyIntent("retry")).toBe("steer")
    expect(steerKeyIntent("idle")).toBe("submit")
    expect(steerKeyIntent(undefined)).toBe("submit")
    expect(promptDelivery(steerKeyIntent("idle"))).toBe("queue")
  })
})

describe("/steer", () => {
  test("parses the text after the command", () => {
    expect(parseSteerCommand("/steer use the other API")).toBe("use the other API")
    expect(parseSteerCommand("/steer\nfirst\nsecond")).toBe("first\nsecond")
    expect(parseSteerCommand("/steer")).toBe("")
    expect(parseSteerCommand("/steer   ")).toBe("")
  })

  test("ignores other input", () => {
    expect(parseSteerCommand("/steering wheel")).toBeUndefined()
    expect(parseSteerCommand("please /steer")).toBeUndefined()
    expect(parseSteerCommand("/share")).toBeUndefined()
  })

  test("strips the prefix and keeps the parts, with their offsets moved", () => {
    type TestPart = { type: string; url?: string; name?: string; source?: unknown }
    const file = {
      type: "file",
      url: "file:///a.ts",
      source: { type: "file", path: "a.ts", text: { value: "@a.ts", start: 12, end: 17 } },
    }
    const agent = { type: "agent", name: "explore", source: { value: "@explore", start: 18, end: 26 } }
    const plain = { type: "file", url: "data:," }
    const input = "/steer read @a.ts @explore"
    expect(input.slice(12, 17)).toBe("@a.ts")
    const result = stripSteerCommand<TestPart>(input, [file, agent, plain])
    expect(result?.text).toBe("read @a.ts @explore")
    expect(result?.parts).toEqual([
      { ...file, source: { ...file.source, text: { value: "@a.ts", start: 5, end: 10 } } },
      { ...agent, source: { value: "@explore", start: 11, end: 19 } },
      plain,
    ])
    expect(result?.text.slice(5, 10)).toBe("@a.ts")
    expect(result?.text.slice(11, 19)).toBe("@explore")
    // The input parts are left untouched for the prompt history.
    expect(file.source.text.start).toBe(12)
    expect(stripSteerCommand("read @a.ts", [file])).toBeUndefined()
  })
})

describe("busy hint", () => {
  test("names both keys", () => {
    expect(busyHint({ submitKey: "return", steerKey: "alt+return", kittyKeyboard: true })).toBe(
      "return queue · alt+return steer",
    )
    expect(busyHint({ submitKey: "return", steerKey: "alt+return" })).toBe("return queue · alt+return steer")
    // Without the kitty protocol alt+return may only arrive as a bare ESC CR, which stays a newline.
    expect(busyHint({ submitKey: "return", steerKey: "alt+return", kittyKeyboard: false })).toBe(
      "return queue · /steer steer",
    )
  })

  test("falls back to /steer when the terminal cannot report the steer key", () => {
    // shift+return has no legacy encoding: a plain return is all a terminal without kitty sends.
    expect(steerKeyAmbiguous("shift+return", false)).toBe(true)
    expect(steerKeyAmbiguous("shift+return", undefined)).toBe(false)
    expect(steerKeyAmbiguous("alt+s", false)).toBe(false)
    expect(busyHint({ submitKey: "return", steerKey: "shift+return", kittyKeyboard: false })).toBe(
      "return queue · /steer steer",
    )
    expect(busyHint({ submitKey: "return", steerKey: "alt+s", kittyKeyboard: false })).toBe(
      "return queue · alt+s steer",
    )
  })

  test("falls back to /steer in hosts that swallow alt+return out of the box", () => {
    expect(altReturnUnreported({ TERM_PROGRAM: "Apple_Terminal" })).toBe(true)
    expect(altReturnUnreported({ WT_SESSION: "8f2c…" })).toBe(true)
    // WezTerm binds alt+enter to ToggleFullScreen by default.
    expect(altReturnUnreported({ TERM_PROGRAM: "WezTerm" })).toBe(true)
    expect(altReturnUnreported({ TERM_PROGRAM: "iTerm.app" })).toBe(false)
    expect(altReturnUnreported({})).toBe(false)
    expect(steerKeyAmbiguous("alt+return", false, { TERM_PROGRAM: "Apple_Terminal" })).toBe(true)
    expect(steerKeyAmbiguous("alt+return", false, { WT_SESSION: "8f2c…" })).toBe(true)
    expect(steerKeyAmbiguous("alt+return", false, { TERM_PROGRAM: "WezTerm" })).toBe(true)
    // A host binding takes the key before any protocol can report it.
    expect(steerKeyAmbiguous("alt+return", true, { TERM_PROGRAM: "WezTerm" })).toBe(true)
    expect(steerKeyAmbiguous("alt+return", true, { TERM_PROGRAM: "ghostty" })).toBe(false)
    expect(steerKeyAmbiguous("alt+return", undefined, {})).toBe(false)
    expect(
      busyHint({ submitKey: "return", steerKey: "alt+return", kittyKeyboard: false, env: { WT_SESSION: "x" } }),
    ).toBe("return queue · /steer steer")
  })

  test("falls back to /steer when the steer key is unbound", () => {
    expect(busyHint({ submitKey: "return", steerKey: "" })).toBe("return queue · /steer steer")
  })
})

describe("the queued prompt an empty steer acts on", () => {
  const assistant = (id: string, completed?: number) => ({
    id,
    role: "assistant",
    time: { created: 1, ...(completed === undefined ? {} : { completed }) },
  })
  const user = (id: string) => ({ id, role: "user", time: { created: 2 } })
  const none = () => false

  test("nothing is waiting while the session is idle", () => {
    const messages = [assistant("a1", 2), user("u2")]
    expect(pendingAssistantIndex(messages, "idle")).toBeUndefined()
    // An open assistant message left by a killed process is not a running turn.
    expect(pendingAssistantIndex([user("u1"), assistant("a1")], undefined)).toBeUndefined()
    expect(latestQueuedPrompt({ messages, statusType: "idle", settled: none })).toBeUndefined()
  })

  test("the most recent prompt behind the running turn wins", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), user("u3")]
    expect(pendingAssistantIndex(messages, "busy")).toBe(1)
    expect(latestQueuedPrompt({ messages, statusType: "busy", settled: none })).toBe("u3")
  })

  test("a prompt already steered is not offered again", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), user("u3")]
    const settled = (id: string) => id === "u3"
    expect(latestQueuedPrompt({ messages, statusType: "busy", settled })).toBe("u2")
    expect(
      latestQueuedPrompt({ messages, statusType: "busy", settled: (id) => id === "u2" || id === "u3" }),
    ).toBeUndefined()
  })

  test("a prompt the loop has already promoted is not offered", () => {
    // Promotion re-stamps the message to now, so a just-promoted steer still sits after the open
    // assistant message; only the promotion itself says it is gone from the queue.
    const messages = [user("u1"), assistant("a1"), user("u2")]
    expect(latestQueuedPrompt({ messages, statusType: "busy", settled: none })).toBe("u2")
    expect(latestQueuedPrompt({ messages, statusType: "busy", settled: (id) => id === "u2" })).toBeUndefined()
  })

  test("nothing is waiting when the turn has no prompt behind it", () => {
    const messages = [user("u1"), assistant("a1")]
    expect(latestQueuedPrompt({ messages, statusType: "busy", settled: none })).toBeUndefined()
  })

  test("the hint says the key steers what is queued", () => {
    expect(busyHint({ submitKey: "return", steerKey: "alt+return", kittyKeyboard: true, queued: true })).toBe(
      "return queue · alt+return steer queued",
    )
    expect(busyHint({ submitKey: "return", steerKey: "shift+return", kittyKeyboard: false, queued: true })).toBe(
      "return queue · /steer steer queued",
    )
  })
})

describe("badges", () => {
  test("a pending steer is told apart from a queued prompt", () => {
    expect(pendingBadge(true)).toEqual({ label: "STEER", tone: "steer" })
    expect(pendingBadge(false)).toEqual({ label: "QUEUED", tone: "queue" })
  })

  test("a promoted steer says where it landed", () => {
    const tool = { id: "a1", role: "assistant", finish: "tool-calls", time: { created: 1, completed: 2 } }
    const open = { id: "a1", role: "assistant", time: { created: 1 } }
    const stopped = { id: "a1", role: "assistant", finish: "stop", time: { created: 1, completed: 2 } }
    const steer = { id: "u2", role: "user", time: { created: 3 } }
    expect(steeredAt([tool, steer], "u2")).toBe("mid-turn")
    expect(steeredAt([open, steer], "u2")).toBe("mid-turn")
    expect(steeredAt([stopped, steer], "u2")).toBe("idle")
    expect(steeredAt([steer], "u2")).toBe("idle")
    expect(steeredLabel("mid-turn")).toBe("↳ steered mid-turn")
    expect(steeredLabel("idle")).toBe("↳ steered")
  })
})

describe("keybind defaults", () => {
  test("alt+return steers, shift+return is only ever a newline", () => {
    const keybinds = TuiKeybind.parse({})
    expect(keybinds.input_steer).toBe("alt+return")
    // alt+return stays a newline for terminals that send ESC CR for Shift+Enter.
    expect(keybinds.input_newline).toBe("shift+return,ctrl+return,alt+return,ctrl+j")
    expect(keybinds.input_submit).toBe("return")
    expect(TuiKeybind.CommandMap.input_steer).toBe("input.steer")
  })

  test("both stay configurable", () => {
    const keybinds = TuiKeybind.parse({ input_steer: "alt+s", input_newline: "shift+return,ctrl+j" })
    expect(keybinds.input_steer).toBe("alt+s")
    expect(keybinds.input_newline).toBe("shift+return,ctrl+j")
  })

  test("the old steer key stays honoured when set explicitly", () => {
    // A config written for the shift+return days keeps working: explicit config wins over defaults.
    expect(TuiKeybind.parse({ input_steer: "shift+return" }).input_steer).toBe("shift+return")
    expect(TuiKeybind.parse({ input_newline: "shift+return", input_steer: "shift+return" }).input_steer).toBe(
      "shift+return",
    )
  })

  test("a configured input_newline on the steer key takes it from the steer default", () => {
    expect(TuiKeybind.parse({ input_newline: "alt+return,ctrl+j" }).input_steer).toBe("none")
    expect(TuiKeybind.parse({ input_newline: ["ctrl+j", "Alt+Enter"] }).input_steer).toBe("none")
    // Only a configured input_newline gives up the key; the default shares it (see legacyAltReturn).
    expect(TuiKeybind.parse({ input_newline: "shift+return,ctrl+return,alt+return,ctrl+j" }).input_steer).toBe("none")
    // shift+return under input_newline is no conflict any more: steer does not live there.
    expect(TuiKeybind.parse({ input_newline: "shift+return,ctrl+j" }).input_steer).toBe("alt+return")
    expect(TuiKeybind.parse({ input_newline: ["ctrl+j", "Shift+Enter"] }).input_steer).toBe("alt+return")
    // Explicitly set, both keep the key; the steer layer wins.
    expect(TuiKeybind.parse({ input_newline: "alt+return", input_steer: "alt+return" }).input_steer).toBe("alt+return")
  })
})
