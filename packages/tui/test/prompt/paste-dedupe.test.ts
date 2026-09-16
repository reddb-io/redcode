import { expect, test } from "bun:test"
import { createPasteDedupe, PASTE_DEDUPE_WINDOW_MS } from "../../src/component/prompt/paste-dedupe"

function clock() {
  const state = { now: 1_000 }
  return { state, now: () => state.now }
}

test("a bracketed paste of the text the paste key just inserted is dropped", () => {
  const time = clock()
  const dedupe = createPasteDedupe(time.now)
  const started = dedupe.keyStarted()
  expect(dedupe.acceptKeyText(started, "hello\r\n")).toBe(true)
  time.state.now += 50
  expect(dedupe.acceptTerminalText("hello")).toBe(false)
})

test("clipboard text read after the terminal already pasted it is dropped", () => {
  const time = clock()
  const dedupe = createPasteDedupe(time.now)
  const started = dedupe.keyStarted()
  time.state.now += 20
  expect(dedupe.acceptTerminalText("hello")).toBe(true)
  time.state.now += 20
  expect(dedupe.acceptKeyText(started, "hello")).toBe(false)
})

test("different text, a later paste, or the same source twice all insert", () => {
  const time = clock()
  const dedupe = createPasteDedupe(time.now)
  expect(dedupe.acceptKeyText(dedupe.keyStarted(), "hello")).toBe(true)
  expect(dedupe.acceptTerminalText("other")).toBe(true)
  expect(dedupe.acceptKeyText(dedupe.keyStarted(), "hello")).toBe(true)
  time.state.now += PASTE_DEDUPE_WINDOW_MS + 1
  expect(dedupe.acceptTerminalText("hello")).toBe(true)
  expect(dedupe.acceptTerminalText("hello")).toBe(true)
})

test("an empty bracketed paste reads the clipboard only when the paste key did not just do so", () => {
  const time = clock()
  const dedupe = createPasteDedupe(time.now)
  expect(dedupe.acceptTerminalEmpty()).toBe(true)
  dedupe.keyStarted()
  time.state.now += 100
  expect(dedupe.acceptTerminalEmpty()).toBe(false)
  time.state.now += PASTE_DEDUPE_WINDOW_MS
  expect(dedupe.acceptTerminalEmpty()).toBe(true)
})
