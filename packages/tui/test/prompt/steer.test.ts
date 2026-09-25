import { describe, expect, test } from "bun:test"
import {
  busyHint,
  latestQueuedPrompt,
  parseSlashCommand,
  pendingAssistantIndex,
  pendingBadge,
  promptDelivery,
  steeredAt,
  steeredLabel,
  promptKeyActive,
  queueKeyAmbiguous,
  queueKeyIntent,
  steerKeyIntent,
  altReturnUnreported,
  bindsAltReturn,
  distinctShiftReturn,
  escCrIsAltReturn,
  legacyAltReturn,
  promptKeyRejects,
  stripSlashCommand,
} from "../../src/prompt/steer"
import { TuiKeybind } from "../../src/config/keybind"

describe("prompt delivery", () => {
  test("Enter and the steer key send steer, only the queue key sends queue", () => {
    expect(promptDelivery("submit")).toBe("steer")
    expect(promptDelivery("steer")).toBe("steer")
    expect(promptDelivery("queue")).toBe("queue")
  })

  test("the queue key layer is live whenever the prompt takes input", () => {
    expect(promptKeyActive({ focused: true, disabled: false })).toBe(true)
    expect(promptKeyActive({ focused: false, disabled: false })).toBe(false)
    expect(promptKeyActive({ focused: true, disabled: true })).toBe(false)
  })

  test("a bare ESC CR is not a queue key press", () => {
    // Legacy alt+return and a Shift+Enter mapped to ESC CR send the same bytes.
    expect(legacyAltReturn({ raw: "\x1b\r", sequence: "\x1b\r", source: "raw" })).toBe(true)
    expect(legacyAltReturn({ sequence: "\x1b\r" })).toBe(true)
    // Reported unambiguously: kitty CSI 13;3u and modifyOtherKeys CSI 27;3;13~.
    expect(legacyAltReturn({ raw: "\x1b[13;3u", sequence: "\x1b[13;3u", source: "kitty" })).toBe(false)
    expect(legacyAltReturn({ raw: "\x1b[27;3;13~", sequence: "\x1b[27;3;13~", source: "raw" })).toBe(false)
    // Dispatched from the palette or a test, with no key event at all.
    expect(legacyAltReturn(undefined)).toBe(false)
  })

  test("a bare ESC CR queues once Shift+Enter is known to be something else", () => {
    const escCr = { raw: "\x1b\r", sequence: "\x1b\r", source: "raw" }
    const defaults = { shiftReturnReported: false, newlineOnAltReturn: true }
    expect(promptKeyRejects(escCr, defaults)).toBe(true)
    expect(promptKeyRejects(escCr, { ...defaults, shiftReturnReported: true })).toBe(false)
    expect(promptKeyRejects(escCr, { ...defaults, newlineOnAltReturn: false })).toBe(false)
    expect(escCrIsAltReturn(defaults)).toBe(false)
    // An unambiguous report is never rejected.
    expect(promptKeyRejects({ raw: "\x1b[13;3u", sequence: "\x1b[13;3u", source: "kitty" }, defaults)).toBe(false)
  })

  test("only a CSI report of shift+return counts as proof", () => {
    expect(distinctShiftReturn({ name: "return", shift: true, raw: "\x1b[13;2u", source: "kitty" })).toBe(true)
    expect(distinctShiftReturn({ name: "return", shift: true, raw: "\x1b[27;2;13~", source: "raw" })).toBe(true)
    expect(distinctShiftReturn({ name: "return", shift: false, raw: "\r", source: "raw" })).toBe(false)
    expect(distinctShiftReturn({ name: "return", shift: false, raw: "\x1b\r", source: "raw" })).toBe(false)
    expect(distinctShiftReturn({ name: "return", shift: true })).toBe(false)
    expect(distinctShiftReturn(undefined)).toBe(false)
  })

  test("reads alt+return out of input_newline bindings", () => {
    expect(bindsAltReturn([{ key: "shift+return,ctrl+return,alt+return,ctrl+j" }])).toBe(true)
    expect(bindsAltReturn([{ key: "meta+enter" }])).toBe(true)
    expect(bindsAltReturn([{ key: { name: "return", meta: true } }])).toBe(true)
    expect(bindsAltReturn([{ key: "shift+return" }, { key: "ctrl+j" }])).toBe(false)
    expect(bindsAltReturn([{ key: "ctrl+alt+return" }])).toBe(false)
    expect(bindsAltReturn([{ key: { name: "return", meta: true, shift: true } }])).toBe(false)
    // The default input_newline keeps alt+return as the ESC CR newline.
    expect(bindsAltReturn([{ key: TuiKeybind.parse({}).input_newline }])).toBe(true)
  })

  test("the queue key queues while the session works and submits when idle", () => {
    expect(queueKeyIntent("busy")).toBe("queue")
    expect(queueKeyIntent("retry")).toBe("queue")
    expect(queueKeyIntent("idle")).toBe("submit")
    expect(queueKeyIntent(undefined)).toBe("submit")
    expect(promptDelivery(queueKeyIntent("busy"))).toBe("queue")
    // Idle, alt+return sends exactly what Enter sends.
    expect(promptDelivery(queueKeyIntent("idle"))).toBe(promptDelivery("submit"))
  })

  test("a configured steer key steers while the session works and submits when idle", () => {
    expect(steerKeyIntent("busy")).toBe("steer")
    expect(steerKeyIntent("idle")).toBe("submit")
    expect(promptDelivery(steerKeyIntent("busy"))).toBe("steer")
  })
})

describe("/queue", () => {
  test("parses the text after the command", () => {
    expect(parseSlashCommand("queue", "/queue run the tests after")).toBe("run the tests after")
    expect(parseSlashCommand("queue", "/queue\nfirst\nsecond")).toBe("first\nsecond")
    expect(parseSlashCommand("queue", "/queue")).toBe("")
    expect(parseSlashCommand("queue", "/queue   ")).toBe("")
  })

  test("ignores other input", () => {
    expect(parseSlashCommand("queue", "/queued work")).toBeUndefined()
    expect(parseSlashCommand("queue", "please /queue")).toBeUndefined()
    expect(parseSlashCommand("queue", "/steer now")).toBeUndefined()
  })

  test("strips the command prefix and moves the parts' offsets", () => {
    const file = {
      type: "file",
      url: "file:///a.ts",
      source: { type: "file", path: "a.ts", text: { value: "@a.ts", start: 13, end: 18 } },
    }
    const input = "/queue check @a.ts"
    expect(input.slice(13, 18)).toBe("@a.ts")
    const result = stripSlashCommand("queue", input, [file])
    expect(result?.text).toBe("check @a.ts")
    expect(result?.parts).toEqual([
      { ...file, source: { ...file.source, text: { value: "@a.ts", start: 5, end: 10 } } },
    ])
    expect(stripSlashCommand("queue", "/steer check", [file])).toBeUndefined()
  })
})

describe("/steer", () => {
  test("parses the text after the command", () => {
    expect(parseSlashCommand("steer", "/steer use the other API")).toBe("use the other API")
    expect(parseSlashCommand("steer", "/steer\nfirst\nsecond")).toBe("first\nsecond")
    expect(parseSlashCommand("steer", "/steer")).toBe("")
    expect(parseSlashCommand("steer", "/steer   ")).toBe("")
  })

  test("ignores other input", () => {
    expect(parseSlashCommand("steer", "/steering wheel")).toBeUndefined()
    expect(parseSlashCommand("steer", "please /steer")).toBeUndefined()
    expect(parseSlashCommand("steer", "/share")).toBeUndefined()
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
    const result = stripSlashCommand<TestPart>("steer", input, [file, agent, plain])
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
    expect(stripSlashCommand("steer", "read @a.ts", [file])).toBeUndefined()
  })
})

describe("busy hint", () => {
  test("names both keys: Enter steers, the queue key queues", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: true })).toBe(
      "return steer · alt+return queue",
    )
    expect(busyHint({ submitKey: "return", queueKey: "alt+return" })).toBe("return steer · alt+return queue")
    // Without the kitty protocol alt+return may only arrive as a bare ESC CR, which stays a newline.
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: false })).toBe(
      "return steer · /queue queue",
    )
  })

  test("falls back to /queue when the terminal cannot report the queue key", () => {
    // shift+return has no legacy encoding: a plain return is all a terminal without kitty sends.
    expect(queueKeyAmbiguous("shift+return", false)).toBe(true)
    expect(queueKeyAmbiguous("shift+return", undefined)).toBe(false)
    expect(queueKeyAmbiguous("alt+s", false)).toBe(false)
    expect(busyHint({ submitKey: "return", queueKey: "shift+return", kittyKeyboard: false })).toBe(
      "return steer · /queue queue",
    )
    expect(busyHint({ submitKey: "return", queueKey: "alt+s", kittyKeyboard: false })).toBe(
      "return steer · alt+s queue",
    )
  })

  test("falls back to /queue in hosts that swallow alt+return out of the box", () => {
    expect(altReturnUnreported({ TERM_PROGRAM: "Apple_Terminal" })).toBe(true)
    expect(altReturnUnreported({ WT_SESSION: "8f2c…" })).toBe(true)
    // WezTerm binds alt+enter to ToggleFullScreen by default.
    expect(altReturnUnreported({ TERM_PROGRAM: "WezTerm" })).toBe(true)
    expect(altReturnUnreported({ TERM_PROGRAM: "iTerm.app" })).toBe(false)
    expect(altReturnUnreported({})).toBe(false)
    expect(queueKeyAmbiguous("alt+return", false, { TERM_PROGRAM: "Apple_Terminal" })).toBe(true)
    expect(queueKeyAmbiguous("alt+return", false, { WT_SESSION: "8f2c…" })).toBe(true)
    expect(queueKeyAmbiguous("alt+return", false, { TERM_PROGRAM: "WezTerm" })).toBe(true)
    // A host binding takes the key before any protocol can report it.
    expect(queueKeyAmbiguous("alt+return", true, { TERM_PROGRAM: "WezTerm" })).toBe(true)
    expect(queueKeyAmbiguous("alt+return", true, { TERM_PROGRAM: "ghostty" })).toBe(false)
    expect(queueKeyAmbiguous("alt+return", undefined, {})).toBe(false)
    expect(
      busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: false, env: { WT_SESSION: "x" } }),
    ).toBe("return steer · /queue queue")
  })

  test("names alt+return once a bare ESC CR queues, except where the host keeps the key", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: false, escCrQueues: true })).toBe(
      "return steer · alt+return queue",
    )
    expect(queueKeyAmbiguous("alt+return", false, { TERM_PROGRAM: "WezTerm" }, true)).toBe(true)
  })

  test("falls back to /queue when the queue key is unbound", () => {
    expect(busyHint({ submitKey: "return", queueKey: "" })).toBe("return steer · /queue queue")
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

  test("the hint says Enter steers what is queued", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: true, queued: true })).toBe(
      "return steer queued · alt+return queue",
    )
    expect(busyHint({ submitKey: "return", queueKey: "shift+return", kittyKeyboard: false, queued: true })).toBe(
      "return steer queued · /queue queue",
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
  test("alt+return queues, Enter submits (steering), shift+return is only ever a newline", () => {
    const keybinds = TuiKeybind.parse({})
    expect(keybinds.input_queue).toBe("alt+return")
    expect(keybinds.input_steer).toBe("none")
    // alt+return stays a newline for terminals that send ESC CR for Shift+Enter.
    expect(keybinds.input_newline).toBe("shift+return,ctrl+return,alt+return,ctrl+j")
    expect(keybinds.input_submit).toBe("return")
    expect(TuiKeybind.CommandMap.input_queue).toBe("input.queue")
    expect(TuiKeybind.CommandMap.input_steer).toBe("input.steer")
  })

  test("all stay configurable", () => {
    const keybinds = TuiKeybind.parse({
      input_queue: "alt+q",
      input_steer: "alt+s",
      input_newline: "shift+return,ctrl+j",
    })
    expect(keybinds.input_queue).toBe("alt+q")
    expect(keybinds.input_steer).toBe("alt+s")
    expect(keybinds.input_newline).toBe("shift+return,ctrl+j")
  })

  test("an explicit input_steer on alt+return, from when it was the steer key, keeps it", () => {
    const keybinds = TuiKeybind.parse({ input_steer: "alt+return" })
    expect(keybinds.input_steer).toBe("alt+return")
    expect(keybinds.input_queue).toBe("none")
    // The shift+return days keep working too, and leave alt+return to queue.
    expect(TuiKeybind.parse({ input_steer: "shift+return" }).input_steer).toBe("shift+return")
    expect(TuiKeybind.parse({ input_steer: "shift+return" }).input_queue).toBe("alt+return")
  })

  test("a configured input_newline on the queue key takes it from the queue default", () => {
    expect(TuiKeybind.parse({ input_newline: "alt+return,ctrl+j" }).input_queue).toBe("none")
    expect(TuiKeybind.parse({ input_newline: ["ctrl+j", "Alt+Enter"] }).input_queue).toBe("none")
    // Only a configured input_newline gives up the key; the default shares it (see legacyAltReturn).
    expect(TuiKeybind.parse({ input_newline: "shift+return,ctrl+return,alt+return,ctrl+j" }).input_queue).toBe("none")
    expect(TuiKeybind.parse({ input_newline: "shift+return,ctrl+j" }).input_queue).toBe("alt+return")
    expect(TuiKeybind.parse({ input_newline: ["ctrl+j", "Shift+Enter"] }).input_queue).toBe("alt+return")
    // Explicitly set, both keep the key; the queue layer wins.
    expect(TuiKeybind.parse({ input_newline: "alt+return", input_queue: "alt+return" }).input_queue).toBe("alt+return")
  })
})
