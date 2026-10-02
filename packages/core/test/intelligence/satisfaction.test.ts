import { expect, test } from "bun:test"
import { IntelligenceSatisfaction } from "@opencode/core/intelligence/satisfaction"
import { STOP_LOSS_PROGRESSED } from "@opencode/schema/session-guard"
import { evaluation } from "./fixtures"

const rating = (created: number, choice: string, confidence = 1) =>
  evaluation({
    created,
    operation: "prompt_classification",
    decision: "accepted",
    answers: {
      user_feedback: { type: "choice", choice, confidence, probabilities: { [choice]: 1 } },
    },
  })

test("insufficient reliable feedback is unknown, never zero friction", () => {
  const context = IntelligenceSatisfaction.context([
    rating(1, "rejects"),
    rating(2, "rejects"),
    rating(3, "rejects", 0.59),
    { ...rating(4, "rejects"), decision: "unavailable" },
    { ...rating(5, "rejects"), operation: "response_quality" },
    { ...rating(6, "rejects"), mode: "observe" },
  ])
  expect(context).toContain('"score":null')
  expect(context).toContain('"samples":2')
  expect(context).toContain('"trend":"unknown"')
  expect(context).toContain("do not infer frustration from missing data")
})

test("temperature grows with accumulated failures and excludes Observe history", () => {
  expect(IntelligenceSatisfaction.context([1, 2, 3].map((time) => rating(time, "rejects")))).toContain('"score":5')
  const context = IntelligenceSatisfaction.context([
    ...[1, 2, 3].map((time) => rating(time, "agrees")),
    { ...rating(4, "rejects"), mode: "observe" },
  ])
  expect(context).toContain('"score":0')
  expect(context).toContain('"samples":3')
  expect(context).toContain('"stage":"cool"')
  expect(context).toContain("does not change the objective, permissions, mode, model, effort or budget")
})

test("temperature trend follows new friction and confirmed improvement in chronological order", () => {
  const stable = [1, 2, 3].map((time) => rating(time, "neutral"))
  expect(IntelligenceSatisfaction.context([...stable, rating(4, "rejects")].toReversed())).toContain(
    '"trend":"heating"',
  )
  const failed = [1, 2, 3].map((time) => rating(time, "rejects"))
  expect(IntelligenceSatisfaction.context([...failed, rating(4, "agrees")])).toContain('"trend":"cooling"')
  expect(IntelligenceSatisfaction.context([...stable, rating(4, "neutral")])).toContain('"trend":"stable"')
  expect(IntelligenceSatisfaction.context([...failed, rating(4, "neutral")])).toContain('"score":5')
})

test("guard evidence changes the same reading without changing the stored history", () => {
  const ratings = [1, 2, 3, 4].map((time) => rating(time, "neutral"))
  const original = JSON.stringify(ratings)
  const context = IntelligenceSatisfaction.context(ratings, [
    { guard: "loop", action: "stop", at: 4 },
    { guard: "stop_loss", action: "warn", subject: STOP_LOSS_PROGRESSED, at: 4 },
    { guard: "loop", action: "stop", at: 0 },
  ])
  expect(context).toContain('"stops":1')
  expect(context).toContain('"recovered":1')
  expect(context).toContain('"score":0')
  expect(JSON.stringify(ratings)).toBe(original)
})
