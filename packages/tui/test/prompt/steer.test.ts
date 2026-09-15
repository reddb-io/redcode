import { describe, expect, test } from "bun:test"
import {
  busyHint,
  parseSteerCommand,
  pendingBadge,
  promptDelivery,
  rememberedDelivery,
  steerKeyAmbiguous,
} from "../../src/prompt/steer"
import { TuiKeybind } from "../../src/config/keybind"

describe("prompt delivery", () => {
  test("a busy session queues on submit and steers on the steer key", () => {
    expect(promptDelivery("submit", "busy")).toBe("queue")
    expect(promptDelivery("steer", "busy")).toBe("steer")
    expect(promptDelivery("submit", "retry")).toBe("queue")
    expect(promptDelivery("steer", "retry")).toBe("steer")
  })

  test("an idle session is a plain submit either way", () => {
    expect(promptDelivery("submit", "idle")).toBeUndefined()
    expect(promptDelivery("steer", "idle")).toBeUndefined()
    expect(promptDelivery("steer", undefined)).toBeUndefined()
  })

  test("only prompts admitted while working are remembered", () => {
    expect(rememberedDelivery("steer", "idle")).toBeUndefined()
    expect(rememberedDelivery("steer", undefined)).toBeUndefined()
    expect(rememberedDelivery("steer", "busy")).toBe("steer")
    expect(rememberedDelivery("queue", "busy")).toBe("queue")
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

describe("pending badge", () => {
  test("a pending steer is told apart from a queued prompt", () => {
    expect(pendingBadge("steer")).toEqual({ label: "STEER", tone: "steer" })
    expect(pendingBadge("queue")).toEqual({ label: "QUEUED", tone: "queue" })
    // Admitted before this client connected: delivery unknown, shown as before.
    expect(pendingBadge(undefined)).toEqual({ label: "QUEUED", tone: "queue" })
  })
})

describe("keybind defaults", () => {
  test("shift+return steers and no longer inserts a newline", () => {
    const keybinds = TuiKeybind.parse({})
    expect(keybinds.input_steer).toBe("shift+return")
    expect(keybinds.input_newline).toBe("ctrl+return,alt+return,ctrl+j")
    expect(keybinds.input_submit).toBe("return")
    expect(TuiKeybind.CommandMap.input_steer).toBe("input.steer")
  })

  test("both stay configurable", () => {
    const keybinds = TuiKeybind.parse({ input_steer: "alt+s", input_newline: "shift+return,ctrl+j" })
    expect(keybinds.input_steer).toBe("alt+s")
    expect(keybinds.input_newline).toBe("shift+return,ctrl+j")
  })
})
