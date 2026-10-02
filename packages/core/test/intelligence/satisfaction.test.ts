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

test("insufficient reliable feedback is unknown, never zero satisfaction", () => {
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

test("satisfaction uses the indicator's 0 to 5 direction and excludes Observe history", () => {
  expect(IntelligenceSatisfaction.context([1, 2, 3].map((time) => rating(time, "rejects")))).toContain('"score":0')
  const context = IntelligenceSatisfaction.context([
    ...[1, 2, 3].map((time) => rating(time, "agrees")),
    { ...rating(4, "rejects"), mode: "observe" },
  ])
  expect(context).toContain('"score":5')
  expect(context).toContain('"samples":3')
  expect(context).toContain('"stage":"great"')
  expect(context).toContain("does not change the objective, permissions, mode, model, effort or budget")
})

test("trend follows the latest reliable reaction in chronological order", () => {
  const stable = [1, 2, 3].map((time) => rating(time, "neutral"))
  expect(IntelligenceSatisfaction.context([...stable, rating(4, "rejects")].toReversed())).toContain(
    '"trend":"worsening"',
  )
  expect(IntelligenceSatisfaction.context([...stable, rating(4, "agrees")])).toContain('"trend":"improving"')
  expect(IntelligenceSatisfaction.context([...stable, rating(4, "neutral")])).toContain('"trend":"stable"')
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
  expect(context).toContain('"score":2')
  expect(JSON.stringify(ratings)).toBe(original)
})
