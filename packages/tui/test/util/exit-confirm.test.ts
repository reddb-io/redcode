import { describe, expect, test } from "bun:test"
import { accidentalExitKey, createExitConfirm, EXIT_CONFIRM_WINDOW } from "../../src/util/exit-confirm"

function key(name: string, modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  return { name, ctrl: modifiers.ctrl ?? false, meta: modifiers.meta ?? false, shift: modifiers.shift ?? false }
}

describe("accidentalExitKey", () => {
  test("names bare ctrl+c and ctrl+d", () => {
    expect(accidentalExitKey(key("c", { ctrl: true }))).toBe("ctrl+c")
    expect(accidentalExitKey(key("d", { ctrl: true }))).toBe("ctrl+d")
  })

  test("leaves deliberate exits alone", () => {
    expect(accidentalExitKey(undefined)).toBeUndefined()
    expect(accidentalExitKey(key("q"))).toBeUndefined()
    expect(accidentalExitKey(key("return"))).toBeUndefined()
    expect(accidentalExitKey(key("c", { ctrl: true, shift: true }))).toBeUndefined()
    expect(accidentalExitKey(key("c", { ctrl: true, meta: true }))).toBeUndefined()
  })
})

describe("createExitConfirm", () => {
  test("confirms only the same key pressed again within the window", () => {
    const clock = { now: 1_000 }
    const confirm = createExitConfirm(EXIT_CONFIRM_WINDOW, () => clock.now)
    expect(confirm.press("ctrl+c")).toBe(false)
    clock.now += 500
    expect(confirm.press("ctrl+c")).toBe(true)
    clock.now += 100
    expect(confirm.press("ctrl+c")).toBe(false)
  })

  test("a different key or an expired press starts over", () => {
    const clock = { now: 1_000 }
    const confirm = createExitConfirm(EXIT_CONFIRM_WINDOW, () => clock.now)
    expect(confirm.press("ctrl+c")).toBe(false)
    expect(confirm.press("ctrl+d")).toBe(false)
    clock.now += EXIT_CONFIRM_WINDOW + 1
    expect(confirm.press("ctrl+d")).toBe(false)
    clock.now += 100
    expect(confirm.press("ctrl+d")).toBe(true)
  })
})
