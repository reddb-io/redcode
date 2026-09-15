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
  stripSteerCommand,
} from "../../src/prompt/steer"
import { TuiKeybind } from "../../src/config/keybind"

describe("prompt delivery", () => {
  test("submit always sends queue and the steer key always sends steer", () => {
    expect(promptDelivery("submit")).toBe("queue")
    expect(promptDelivery("steer")).toBe("steer")
  })

  test("the steer key is only active while the session works", () => {
    expect(steerKeyActive({ focused: true, disabled: false, statusType: "busy" })).toBe(true)
    expect(steerKeyActive({ focused: true, disabled: false, statusType: "retry" })).toBe(true)
    expect(steerKeyActive({ focused: true, disabled: false, statusType: "idle" })).toBe(false)
    expect(steerKeyActive({ focused: true, disabled: false, statusType: undefined })).toBe(false)
    expect(steerKeyActive({ focused: false, disabled: false, statusType: "busy" })).toBe(false)
    expect(steerKeyActive({ focused: true, disabled: true, statusType: "busy" })).toBe(false)
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
    expect(busyHint({ submitKey: "return", steerKey: "shift+return", kittyKeyboard: true })).toBe(
      "return queue · shift+return steer",
    )
    expect(busyHint({ submitKey: "return", steerKey: "shift+return" })).toBe("return queue · shift+return steer")
  })

  test("falls back to /steer when the terminal cannot report shift+return", () => {
    expect(steerKeyAmbiguous("shift+return", false)).toBe(true)
    expect(steerKeyAmbiguous("alt+s", false)).toBe(false)
    expect(steerKeyAmbiguous("shift+return", undefined)).toBe(false)
    expect(busyHint({ submitKey: "return", steerKey: "shift+return", kittyKeyboard: false })).toBe(
      "return queue · /steer steer",
    )
    expect(busyHint({ submitKey: "return", steerKey: "alt+s", kittyKeyboard: false })).toBe(
      "return queue · alt+s steer",
    )
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
    expect(latestQueuedPrompt({ messages, statusType: "idle", isSteer: none })).toBeUndefined()
  })

  test("the most recent prompt behind the running turn wins", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), user("u3")]
    expect(pendingAssistantIndex(messages, "busy")).toBe(1)
    expect(latestQueuedPrompt({ messages, statusType: "busy", isSteer: none })).toBe("u3")
  })

  test("a prompt already steered is not offered again", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), user("u3")]
    const isSteer = (id: string) => id === "u3"
    expect(latestQueuedPrompt({ messages, statusType: "busy", isSteer })).toBe("u2")
    expect(
      latestQueuedPrompt({ messages, statusType: "busy", isSteer: (id) => id === "u2" || id === "u3" }),
    ).toBeUndefined()
  })

  test("nothing is waiting when the turn has no prompt behind it", () => {
    const messages = [user("u1"), assistant("a1")]
    expect(latestQueuedPrompt({ messages, statusType: "busy", isSteer: none })).toBeUndefined()
  })

  test("the hint says the key steers what is queued", () => {
    expect(busyHint({ submitKey: "return", steerKey: "shift+return", kittyKeyboard: true, queued: true })).toBe(
      "return queue · shift+return steer queued",
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
  test("shift+return steers while busy and stays a newline key", () => {
    const keybinds = TuiKeybind.parse({})
    expect(keybinds.input_steer).toBe("shift+return")
    expect(keybinds.input_newline).toBe("shift+return,ctrl+return,alt+return,ctrl+j")
    expect(keybinds.input_submit).toBe("return")
    expect(TuiKeybind.CommandMap.input_steer).toBe("input.steer")
  })

  test("both stay configurable", () => {
    const keybinds = TuiKeybind.parse({ input_steer: "alt+s", input_newline: "shift+return,ctrl+j" })
    expect(keybinds.input_steer).toBe("alt+s")
    expect(keybinds.input_newline).toBe("shift+return,ctrl+j")
  })

  test("a configured input_newline on the steer key takes it from the steer default", () => {
    expect(TuiKeybind.parse({ input_newline: "shift+return,ctrl+j" }).input_steer).toBe("none")
    expect(TuiKeybind.parse({ input_newline: ["ctrl+j", "Shift+Enter"] }).input_steer).toBe("none")
    expect(TuiKeybind.parse({ input_newline: "alt+return" }).input_steer).toBe("shift+return")
    // Explicitly set, both keep the key; the steer layer wins while busy.
    expect(TuiKeybind.parse({ input_newline: "shift+return", input_steer: "shift+return" }).input_steer).toBe(
      "shift+return",
    )
  })
})
