import { expect, test } from "bun:test"
import { DialogEscape } from "../../src/util/dialog-escape"

test("a second dismissal within the window escapes, a late one starts over", () => {
  const clock = { now: 0 }
  const pressed = DialogEscape.createPresses(5_000, () => clock.now)
  expect(pressed()).toBe(false)
  clock.now = 4_000
  expect(pressed()).toBe(true)
  clock.now = 5_000
  expect(pressed()).toBe(false)
  clock.now = 11_000
  expect(pressed()).toBe(false)
  clock.now = 12_000
  expect(pressed()).toBe(true)
})

test("remote servers get the longer reply delay", () => {
  expect(DialogEscape.replyDelay(undefined)).toBe(DialogEscape.LOCAL_REPLY_MS)
  expect(DialogEscape.replyDelay("http://127.0.0.1:4096")).toBe(DialogEscape.LOCAL_REPLY_MS)
  expect(DialogEscape.replyDelay("http://localhost:4096")).toBe(DialogEscape.LOCAL_REPLY_MS)
  expect(DialogEscape.replyDelay("http://[::1]:4096")).toBe(DialogEscape.LOCAL_REPLY_MS)
  expect(DialogEscape.replyDelay("https://redcode.example.com")).toBe(DialogEscape.REMOTE_REPLY_MS)
  expect(DialogEscape.replyDelay("not a url")).toBe(DialogEscape.LOCAL_REPLY_MS)
})
