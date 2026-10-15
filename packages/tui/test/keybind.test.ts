import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("binds agent cycling only to shift+tab by default", () => {
  expect(TuiKeybind.Definitions["agent.cycle"].default).toBe("shift+tab")
  expect(TuiKeybind.Definitions["agent.cycle.reverse"].default).toBe("none")
})

// Terminals with the kitty keyboard protocol (and zellij for such panes) forward Ctrl+Shift+V as a key.
test("binds paste to terminal shortcuts and an Alt+V fallback", () => {
  expect(TuiKeybind.Definitions["prompt.paste"].default).toEqual({
    key: "ctrl+v,ctrl+shift+v,alt+v,shift+insert",
    preventDefault: false,
  })
})
