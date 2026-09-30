import { describe, expect, test } from "bun:test"
import { secretKey, secretLength, secretMask, secretPaste } from "../../src/util/secret"

// Assembled from parts so no scanner mistakes the fixture for a real credential.
const FAKE = "ghp" + "_" + "a".repeat(36)

function key(name: string, sequence: string, modifiers: { ctrl?: boolean; meta?: boolean; option?: boolean } = {}) {
  return { name, sequence, ctrl: false, meta: false, option: false, ...modifiers }
}

function type(text: string) {
  return Array.from(text).reduce((value, char) => secretKey(value, key(char, char)) ?? value, "")
}

describe("masked secret input", () => {
  test("types printable characters and deletes the last one on backspace", () => {
    expect(type(FAKE)).toBe(FAKE)
    expect(secretKey("ab", key("space", " "))).toBe("ab ")
    expect(secretKey("abc", key("backspace", "\x7f"))).toBe("ab")
    expect(secretKey("", key("backspace", "\x7f"))).toBe("")
    expect(secretKey("a🔑", key("backspace", "\x7f"))).toBe("a")
  })

  test("leaves enter, escape and modified shortcuts to their bindings", () => {
    expect(secretKey("abc", key("return", "\r"))).toBeUndefined()
    expect(secretKey("abc", key("escape", "\x1b"))).toBeUndefined()
    expect(secretKey("abc", key("v", "v", { ctrl: true }))).toBeUndefined()
    expect(secretKey("abc", key("b", "b", { meta: true }))).toBeUndefined()
    expect(secretKey("abc", key("backspace", "\x7f", { option: true }))).toBeUndefined()
  })

  test("appends a paste without its surrounding line breaks", () => {
    expect(secretPaste("", `${FAKE}\n`)).toBe(FAKE)
    expect(secretPaste("x", "\r\nab\r\ncd\r\n")).toBe("xab\ncd")
  })

  test("the mask shows bullets and a count, never the value", () => {
    const value = type(FAKE)
    const mask = secretMask(secretLength(value))
    expect(mask).not.toContain(FAKE)
    expect(mask).not.toContain("ghp")
    expect(mask).not.toContain("a")
    expect(mask).toBe("•".repeat(40))
    expect(secretMask(secretLength(value + "bcd"))).toBe(`${"•".repeat(40)} +3`)
    expect(secretMask(0)).toBe("")
    expect(secretLength("a🔑")).toBe(2)
  })
})
