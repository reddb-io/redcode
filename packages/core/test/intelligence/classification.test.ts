import { describe, expect, test } from "bun:test"
import { Intelligence } from "@opencode/schema/intelligence"
import { DesignTarget } from "@opencode/core/design/target"
import { IntelligenceClassification } from "@opencode/core/intelligence/classification"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"

const usage = { input_tokens: 0, output_tokens: 0 }

const record = (
  decision: Intelligence.Evaluation["decision"],
  answers: Intelligence.Evaluation["answers"],
): Intelligence.Evaluation => ({
  id: "evaluation",
  fingerprint: "fingerprint",
  sessionID: "ses_test",
  operation: "prompt_classification",
  kind: "classification",
  subjectID: "msg_request",
  policy: IntelligenceEvaluation.POLICY,
  decision,
  model: "jev",
  answers,
  issues: [],
  created: 0,
  duration: 0,
  usage,
})

const choice = (value: string, confidence: number, labels: ReadonlyArray<string>) => ({
  type: "choice" as const,
  choice: value,
  confidence,
  probabilities: Object.fromEntries(labels.map((label) => [label, label === value ? confidence : 0])),
})

describe("System One answer validation", () => {
  const questions: Record<string, Intelligence.Question> = {
    route: { type: "choice", instructions: "Which route?", criteria: { answer: "Answer", change: "Change" } },
  }

  test("rejects a category outside the option list", () => {
    expect(() =>
      IntelligenceEvaluation.validateClassification(questions, {
        model: "jev",
        answers: {
          route: { type: "choice", choice: "deploy", confidence: 0.9, probabilities: { answer: 0.1, change: 0.9 } },
        },
        usage,
      }),
    ).toThrow()
  })

  test("reads a low-confidence answer as inconclusive and a confident one as accepted", () => {
    const answer = (confidence: number) => ({
      model: "jev",
      answers: {
        route: {
          type: "choice" as const,
          choice: "change",
          confidence,
          probabilities: { answer: 1 - confidence, change: confidence },
        },
      },
      usage,
    })
    expect(IntelligenceEvaluation.validateClassification(questions, answer(0.55))).toEqual({
      decision: "inconclusive",
      issues: ["route"],
    })
    expect(IntelligenceEvaluation.validateClassification(questions, answer(0.9))).toEqual({
      decision: "accepted",
      issues: [],
    })
  })

  test("fingerprints an omitted candidate without failing", () => {
    expect(IntelligenceEvaluation.fingerprint(undefined)).toHaveLength(64)
    expect(IntelligenceEvaluation.fingerprint(undefined)).toBe(IntelligenceEvaluation.fingerprint(undefined))
  })
})

describe("IntelligenceClassification", () => {
  test("classifies the request itself, keyed by its message, with a bounded history and the permitted skills", () => {
    const input = IntelligenceClassification.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: "Corrija o login e publique hoje" },
      history: [{ role: "assistant", text: "x".repeat(50_000), tools: ["read"] }],
      omitted: 3,
      session: { mode: "build", goal: "", plan: "" },
      skills: [{ name: "tdd", description: "Test-driven development" }],
    })
    expect(input.operation).toBe("prompt_classification")
    expect(input.kind).toBe("classification")
    expect(input.subjectID).toBe("msg_request")
    expect(input.candidate).toBeUndefined()
    expect(JSON.stringify(input.sources).length).toBeLessThan(40_000)
    expect(Object.keys(input.questions)).toEqual(
      expect.arrayContaining(["work_route", "must_clarify", "design_target", "design_platform", "recommended_skill"]),
    )
    const skill = input.questions.recommended_skill
    expect(skill?.type === "choice" ? Object.keys(skill.criteria) : []).toEqual(["tdd", "no_matching_skill"])
  })

  test("splits a large skill catalog into independently answered groups", () => {
    const skills = Array.from({ length: 45 }, (_, index) => ({ name: `skill-${index}`, description: "Does work" }))
    const questions = IntelligenceClassification.questionsFor(skills)
    expect(Object.keys(questions)).toEqual(expect.arrayContaining(["recommended_skill", "recommended_skill_1"]))
  })

  test("recommends only confident, matching skills, most confident first", () => {
    const evaluation = record("accepted", {
      recommended_skill: choice("tdd", 0.7, ["tdd", "no_matching_skill"]),
      recommended_skill_1: choice("review", 0.9, ["review", "no_matching_skill"]),
      recommended_skill_2: choice("no_matching_skill", 0.95, ["deploy", "no_matching_skill"]),
      recommended_skill_3: choice("deploy", 0.4, ["deploy", "no_matching_skill"]),
    })
    expect(IntelligenceClassification.recommendations(evaluation)).toEqual([
      { name: "review", confidence: 0.9 },
      { name: "tdd", confidence: 0.7 },
    ])
    expect(IntelligenceClassification.skillContext(evaluation)).toContain("review (0.90), tdd (0.70)")
    expect(IntelligenceClassification.skillContext(record("unavailable", {}))).toBeUndefined()
  })

  test("routes and targets a design request only from confident answers", () => {
    const labels = ["answer", "design", "local_change"]
    const evaluation = record("accepted", {
      work_route: choice("design", 0.9, labels),
      design_target: choice("app", 0.8, ["web", "app", "presentation"]),
      design_platform: choice("ios", 0.7, ["ios", "android", "either"]),
    })
    expect(IntelligenceClassification.workRoute(evaluation)).toBe("design")
    expect(DesignTarget.classified(evaluation)).toMatchObject({ target: "app", platform: "ios" })
    expect(
      IntelligenceClassification.workRoute(record("inconclusive", { work_route: choice("design", 0.59, labels) })),
    ).toBeUndefined()
  })

  test("tells the agent when no classification could be verified", () => {
    expect(IntelligenceClassification.context(record("unavailable", {}))).toContain("unavailable")
    expect(IntelligenceClassification.context(undefined)).toBeUndefined()
    const context = IntelligenceClassification.context(
      record("accepted", {
        work_route: choice("local_change", 0.9, ["answer", "local_change"]),
        must_clarify: { type: "noul", noul: 0.9 },
      }),
    )
    expect(context).toContain("work_route: local_change (confidence 0.90)")
    expect(context).toContain("ask the user before dependent work")
  })

  test("exposes only reliable signals for effort selection", () => {
    const evaluation = record("accepted", {
      complexity: {
        type: "score",
        score: 3,
        confidence: 0.8,
        probabilities: { "0": 0, "1": 0, "2": 0.2, "3": 0.8 },
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
      },
      frustration: {
        type: "score",
        score: 2,
        confidence: 0.3,
        probabilities: { "0": 0.3, "1": 0.2, "2": 0.3, "3": 0.2 },
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
      },
      user_feedback: choice("rejects", 0.9, ["agrees", "rejects", "neutral"]),
    })
    expect(IntelligenceClassification.assessment(evaluation)).toMatchObject({
      complexity: 1,
      frustration: undefined,
      feedback: "rejects",
    })
    expect(IntelligenceClassification.assessment(record("unavailable", {}))).toBeUndefined()
  })
})
