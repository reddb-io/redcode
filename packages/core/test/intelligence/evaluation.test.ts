import { describe, expect, test } from "bun:test"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"

const usage = { input_tokens: 0, output_tokens: 0 }
const questions = IntelligenceEvaluation.questions({
  coverage: "Does the candidate claim more than its source?",
  scope: "Does the candidate introduce unrelated work?",
})
const response = (coverage: number, scope: number) => ({
  model: "jev",
  answers: { coverage: { type: "noul" as const, noul: coverage }, scope: { type: "noul" as const, noul: scope } },
  usage,
})

describe("IntelligenceEvaluation.decide", () => {
  test("a gate that approves something keeps the strict bar", () => {
    // Jev's usual answers when the error is absent sit between 0.15 and 0.4.
    expect(IntelligenceEvaluation.decide(questions, response(0.28, 0.18))).toEqual({
      decision: "inconclusive",
      issues: ["coverage", "scope"],
    })
    expect(IntelligenceEvaluation.decide(questions, response(0.05, 0.1))).toEqual({ decision: "accepted", issues: [] })
    expect(IntelligenceEvaluation.decide(questions, response(0.05, 0.28), "task_completion")).toEqual({
      decision: "inconclusive",
      issues: ["scope"],
    })
  })

  test("task quality, whose inconclusive verdict only adds a note, is read by the more probable answer", () => {
    expect(IntelligenceEvaluation.decide(questions, response(0.28, 0.18), "task_quality")).toEqual({
      decision: "accepted",
      issues: [],
    })
    expect(IntelligenceEvaluation.decide(questions, response(0.66, 0.18), "task_quality")).toEqual({
      decision: "inconclusive",
      issues: ["coverage"],
    })
  })

  test("an established error needs revision whatever the operation", () => {
    for (const operation of [undefined, "task_quality", "task_completion"] as const)
      expect(IntelligenceEvaluation.decide(questions, response(0.95, 0.2), operation)).toMatchObject({
        decision: "needs_revision",
      })
  })
})

describe("IntelligenceEvaluation.issueSummary", () => {
  const record = (issues: string[]): Parameters<typeof IntelligenceEvaluation.issueSummary>[0] => ({
    id: "eval_1",
    fingerprint: "fp",
    sessionID: "ses_1",
    operation: "task_quality",
    policy: "test",
    decision: "needs_revision",
    model: "test",
    answers: {},
    issues,
    created: 0,
    duration: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  })

  test("explains the gate questions a model can act on, and leaves other issues as they are", () => {
    expect(
      IntelligenceEvaluation.issueSummary(record(["coverage", "task_0_scope", "task_2_criterion", "note_1"])),
    ).toBe(
      "coverage (it claims more than the selected requirement covers, or relies on truncated source text), task_0_scope (the task contradicts its source requirement or adds unrelated work), task_2_criterion (the task has no observable acceptance criterion; state how its completion is checked), note_1",
    )
  })

  test("still strips the unavailable wrapper", () => {
    expect(
      IntelligenceEvaluation.issueSummary(
        record(["Evaluation unavailable: Evaluator timed out. Previous state preserved."]),
      ),
    ).toBe("Evaluator timed out")
  })
})
