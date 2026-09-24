import { expect, test } from "bun:test"
import type { Part } from "@reddb-io/redcode-sdk/v2"
import { responseRepairLine, revisedAnswer } from "../../src/routes/session/response-repair"

const text = (id: string, messageID: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ id, sessionID: "ses", messageID, type: "text", text: value, ...extra }) as Part

const messages = [
  { id: "user", role: "user" },
  { id: "answer", role: "assistant" },
  { id: "repair", role: "user" },
  { id: "revision", role: "assistant" },
]
const parts = {
  user: [text("p1", "user", "yo, this is a test")],
  answer: [text("p2", "answer", "Hey! Test received loud and clear. What do you need?")],
  repair: [
    text("p3", "repair", "[system:response-quality-repair]", {
      synthetic: true,
      metadata: { responseRepair: { issues: ["omission"] } },
    }),
  ],
  revision: [text("p4", "revision", "Received. What should I work on?")],
}

test("a repaired answer and its revision read as one reply", () => {
  expect(revisedAnswer(messages, parts, 1)).toBe(true)
  expect(revisedAnswer(messages, parts, 3)).toBe(false)
  expect(revisedAnswer(messages, parts, 0)).toBe(false)
  expect(responseRepairLine({ responseRepair: { issues: ["omission"] } })).toBe("revised after S1 review: omission")
})

test("an answer followed by a real prompt or another synthetic note is not a revised one", () => {
  expect(revisedAnswer(messages, { ...parts, repair: [text("p3", "repair", "next question")] }, 1)).toBe(false)
  expect(
    revisedAnswer(
      messages,
      { ...parts, repair: [text("p3", "repair", "keep going", { synthetic: true, metadata: { stopLoss: {} } })] },
      1,
    ),
  ).toBe(false)
  expect(responseRepairLine(undefined)).toBeUndefined()
  expect(responseRepairLine({ responseRepair: "omission" })).toBeUndefined()
})
