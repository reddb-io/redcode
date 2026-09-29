import { describe, expect, test } from "bun:test"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionSchema } from "@opencode/core/session/schema"

const goal: SessionGoal.Info = {
  id: "goal_test",
  sessionID: SessionSchema.ID.make("ses_goal_judge"),
  revision: 3,
  objective: "Ship the export feature",
  criteria: ["Exports open in the viewer", "Tests pass"],
  gates: [],
  stopAfter: "build",
  executePlan: false,
  status: "active",
  reason: "Verifying progress",
  turns: { used: 3, max: 50 },
  tokens: 0,
  reviews: 0,
  evidence: [],
  checks: [],
  created: 0,
  updated: 0,
}

const judged = (decision: Intelligence.Evaluation["decision"], progress?: string): Intelligence.Evaluation => ({
  id: "judgement",
  fingerprint: "fingerprint",
  sessionID: goal.sessionID,
  operation: "session_progress",
  kind: "classification",
  policy: IntelligenceEvaluation.POLICY,
  decision,
  model: "jev",
  answers:
    progress === undefined
      ? {}
      : { progress: { type: "choice", choice: progress, confidence: 0.9, probabilities: { [progress]: 0.9 } } },
  issues: [],
  created: 0,
  duration: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
})

describe("SessionGoal judgement", () => {
  test("asks System One about the latest response without offering it a way to complete the goal", () => {
    const input = SessionGoal.judgement({
      goal,
      response: { id: "msg_answer", text: "Pronto, terminei tudo." },
      tools: { total: 0, omitted: 0, calls: [] },
    })
    expect(input).toMatchObject({
      operation: "session_progress",
      kind: "classification",
      subjectID: "goal_test",
      candidateID: "msg_answer",
      attempt: 3,
    })
    const progress = input.questions.progress
    expect(progress?.type === "choice" ? Object.keys(progress.criteria) : []).toEqual([
      "progressing",
      "stalled",
      "blocked",
      "claims_done",
    ])
  })

  test("reads an unanswered, inconclusive or unexpected judgement as more work, never as completion", () => {
    expect(SessionGoal.verdict(undefined)).toBe("unavailable")
    expect(SessionGoal.verdict(judged("unavailable"))).toBe("unavailable")
    expect(SessionGoal.verdict(judged("inconclusive", "blocked"))).toBe("progressing")
    expect(SessionGoal.verdict(judged("accepted", "done"))).toBe("progressing")
    expect(SessionGoal.verdict(judged("accepted", "blocked"))).toBe("blocked")
    expect(SessionGoal.verdict(judged("accepted", "stalled"))).toBe("stalled")
    expect(SessionGoal.verdict(judged("accepted", "claims_done"))).toBe("claims_done")
  })

  test("continues with the objective and the next step of the budget", () => {
    const text = SessionGoal.continuation(goal, "claims_done")
    expect(text).toContain("step 4 of 50")
    expect(text).toContain("Goal: Ship the export feature")
    expect(text).toContain("goal_complete verifies the evidence")
    expect(SessionGoal.continuation(goal, undefined)).toContain("did not complete the goal")
  })

  test("gives a subagent the objective and criteria but not the budget or completion", () => {
    const text = SessionGoal.inherit(goal)
    expect(text).toContain("Objective: Ship the export feature")
    expect(text).toContain("Criterion 2: Tests pass")
    expect(text).toContain("Only the calling session can complete the goal")
    expect(text).not.toContain("Steps:")
  })
})
