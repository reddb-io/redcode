import { describe, expect, test } from "bun:test"
import {
  bindsAltReturn,
  busyHint,
  distinctShiftReturn,
  emptyPromptTarget,
  escCrIsAltReturn,
  legacyAltReturn,
  parseQueueCommand,
  promptDelivery,
  promptKeyRejects,
  shiftMentions,
} from "../../src/prompt/delivery"

describe("prompt delivery", () => {
  // busy/idle x enter/alt+enter x empty/typed
  const table = [
    { busy: true, key: "enter", typed: true, delivery: "steer", target: undefined },
    { busy: true, key: "enter", typed: false, delivery: "steer", target: "latest" },
    { busy: true, key: "queue", typed: true, delivery: "queue", target: undefined },
    { busy: true, key: "queue", typed: false, delivery: "queue", target: undefined },
    { busy: false, key: "enter", typed: true, delivery: "steer", target: undefined },
    { busy: false, key: "enter", typed: false, delivery: "steer", target: "latest" },
    { busy: false, key: "queue", typed: true, delivery: "steer", target: undefined },
    { busy: false, key: "queue", typed: false, delivery: "steer", target: "latest" },
  ] as const

  table.forEach((row) =>
    test(`busy=${row.busy} key=${row.key} typed=${row.typed}`, () => {
      const delivery = promptDelivery(row.key, row.busy)
      expect(delivery).toBe(row.delivery)
      // Only an empty prompt acts on the queue; a typed prompt is sent with the delivery.
      if (row.typed) return
      expect(emptyPromptTarget(delivery, ["oldest", "latest"])).toBe(row.target)
    }),
  )

  test("an empty steer with nothing queued has no target", () => {
    expect(emptyPromptTarget("steer", [])).toBeUndefined()
  })
})

describe("/queue", () => {
  test("parses only a leading /queue command", () => {
    expect(parseQueueCommand("/queue fix the tests")).toEqual({ text: "fix the tests", prefix: 7 })
    expect(parseQueueCommand("/queue\tfix")).toEqual({ text: "fix", prefix: 7 })
    expect(parseQueueCommand("/queue\nfix")).toEqual({ text: "fix", prefix: 7 })
    expect(parseQueueCommand("/queue")).toEqual({ text: "", prefix: 6 })
    expect(parseQueueCommand("/queued")).toBeUndefined()
    expect(parseQueueCommand("fix /queue")).toBeUndefined()
  })

  test("moves mentions back by the removed prefix", () => {
    expect(
      shiftMentions(
        [{ uri: "file:///a.ts", mention: { start: 11, end: 16, text: "@a.ts" } }, { uri: "file:///b.ts" }],
        7,
      ),
    ).toEqual([{ uri: "file:///a.ts", mention: { start: 4, end: 9, text: "@a.ts" } }, { uri: "file:///b.ts" }])
    expect(shiftMentions(undefined, 7)).toBeUndefined()
  })
})

describe("alt+return encodings", () => {
  const escCr = { raw: "\x1b\r", sequence: "\x1b\r", source: "raw", name: "return" }
  const kitty = { raw: "\x1b[13;3u", sequence: "\x1b[13;3u", source: "kitty", name: "return" }
  const modifyOtherKeys = { raw: "\x1b[27;3;13~", sequence: "\x1b[27;3;13~", source: "raw", name: "return" }
  const legacyTerminal = { shiftReturnReported: false, newlineOnAltReturn: true }

  test("a bare ESC CR stays a newline until the terminal reports Shift+Enter on its own", () => {
    expect(legacyAltReturn(escCr)).toBe(true)
    expect(promptKeyRejects(escCr, legacyTerminal)).toBe(true)
    expect(promptKeyRejects(escCr, { ...legacyTerminal, shiftReturnReported: true })).toBe(false)
    expect(promptKeyRejects(escCr, { ...legacyTerminal, newlineOnAltReturn: false })).toBe(false)
  })

  test("kitty and modifyOtherKeys alt+return always queue", () => {
    expect(promptKeyRejects(kitty, legacyTerminal)).toBe(false)
    expect(promptKeyRejects(modifyOtherKeys, legacyTerminal)).toBe(false)
    expect(promptKeyRejects(undefined, legacyTerminal)).toBe(false)
  })

  test("recognizes Shift+Enter reports that no alt+return shares", () => {
    // zellij writes Shift+Enter as CSI 13;2u to the pane.
    expect(distinctShiftReturn({ raw: "\x1b[13;2u", name: "return", shift: true, source: "kitty" })).toBe(true)
    expect(distinctShiftReturn({ raw: "\x1b[27;2;13~", name: "return", shift: true, source: "raw" })).toBe(true)
    expect(distinctShiftReturn({ raw: "\x1b\r", name: "return", shift: true, source: "raw" })).toBe(false)
    expect(distinctShiftReturn({ raw: "\r", name: "return", source: "raw" })).toBe(false)
  })

  test("finds alt+return in newline bindings", () => {
    expect(bindsAltReturn([{ key: "shift+return,ctrl+return,alt+return,ctrl+j" }])).toBe(true)
    expect(bindsAltReturn([{ key: "shift+return,ctrl+j" }])).toBe(false)
    expect(bindsAltReturn([{ key: { name: "return", meta: true } }])).toBe(true)
    expect(bindsAltReturn([{ key: { name: "return", meta: true, shift: true } }])).toBe(false)
    expect(escCrIsAltReturn({ shiftReturnReported: false, newlineOnAltReturn: false })).toBe(true)
  })
})

describe("busy hint", () => {
  test("names Enter as steer and Alt+Enter as queue", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: true })).toBe(
      "enter steer · alt+enter queue",
    )
  })

  test("says Enter steers the queued prompt when nothing is typed", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: true, queued: true })).toBe(
      "enter steer queued · alt+enter queue",
    )
  })

  test("names /queue where Alt+Enter may not arrive", () => {
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: false })).toBe(
      "enter steer · /queue queue",
    )
    expect(busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: false, escCrQueues: true })).toBe(
      "enter steer · alt+enter queue",
    )
    expect(
      busyHint({ submitKey: "return", queueKey: "alt+return", kittyKeyboard: true, env: { TERM_PROGRAM: "WezTerm" } }),
    ).toBe("enter steer · /queue queue")
    expect(busyHint({ submitKey: "return", queueKey: undefined })).toBe("enter steer · /queue queue")
  })

  test("keeps a non-alt queue key", () => {
    expect(busyHint({ submitKey: "return", queueKey: "ctrl+x return", kittyKeyboard: false })).toBe(
      "enter steer · ctrl+x enter queue",
    )
  })
})
