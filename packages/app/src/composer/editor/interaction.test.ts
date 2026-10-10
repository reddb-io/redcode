import { expect, test } from "bun:test"
import { cyclesAgent, shouldHandlePasteAsAttachment } from "./interaction"

test("cycles the agent on its Tab binding only while the editor owns Tab", () => {
  const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true })
  const cycles = (event: KeyboardEvent) => event.key === "Tab" && event.shiftKey
  const idle = { mode: "normal" as const, popover: { type: "closed" } }

  expect(cyclesAgent(shiftTab, idle, cycles)).toBe(true)
  // Tab alone is not bound, so it keeps moving focus.
  expect(cyclesAgent(new KeyboardEvent("keydown", { key: "Tab" }), idle, cycles)).toBe(false)
  // An open suggestion list takes Tab; shell mode has no agent; a hidden picker binds nothing.
  expect(cyclesAgent(shiftTab, { mode: "normal", popover: { type: "command" } }, cycles)).toBe(false)
  expect(cyclesAgent(shiftTab, { mode: "shell", popover: { type: "closed" } }, cycles)).toBe(false)
  expect(cyclesAgent(shiftTab, idle, undefined)).toBe(false)
  // Mod+. is handled by the global keymap, not here.
  expect(cyclesAgent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true }), idle, () => true)).toBe(false)
})

test("handles clipboard files, and native images only when the clipboard has no text", () => {
  expect(shouldHandlePasteAsAttachment(clipboard(), false)).toBe(false)
  expect(shouldHandlePasteAsAttachment(clipboard(), true)).toBe(true)
  expect(shouldHandlePasteAsAttachment(clipboard(["text/plain"]), true)).toBe(false)
  expect(shouldHandlePasteAsAttachment(clipboard([], [{ kind: "file" }]), false)).toBe(true)
})

function clipboard(types: string[] = [], items: Array<{ kind: string }> = []) {
  return { types, items } as unknown as DataTransfer
}
