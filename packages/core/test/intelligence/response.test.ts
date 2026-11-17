import { describe, expect, test } from "bun:test"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { IntelligenceResponse } from "@opencode/core/intelligence/response"

const review = (
  decision: Intelligence.Evaluation["decision"],
  answers: Record<string, number>,
): Intelligence.Evaluation => ({
  id: "review",
  fingerprint: "fingerprint",
  sessionID: "ses_test",
  operation: "response_quality",
  kind: "gate",
  policy: IntelligenceEvaluation.POLICY,
  decision,
  model: "jev",
  answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: "noul" as const, noul }])),
  issues: Object.entries(answers).flatMap(([id, noul]) => (noul > 0.1 ? [id] : [])),
  created: 0,
  duration: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
})

describe("IntelligenceResponse", () => {
  test("asks only the checks the available evidence can answer", () => {
    expect(
      Object.keys(IntelligenceResponse.questionsFor({ tools: false, tasks: false, goal: false, route: "answer" })),
    ).toEqual(expect.arrayContaining(["correctness", "omission", "refusal"]))
    const plain = Object.keys(IntelligenceResponse.questionsFor({ tools: false, tasks: false, goal: false }))
    expect(plain).not.toContain("tool_evidence")
    expect(plain).not.toContain("premature")
    expect(Object.keys(IntelligenceResponse.questionsFor({ tools: true, tasks: false, goal: true }))).toEqual(
      expect.arrayContaining(["tool_evidence", "premature", "unsupported", "omission"]),
    )
  })

  test("reviews the final response against the request with bounded evidence", () => {
    const input = IntelligenceResponse.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: "Fix the build" },
      candidate: { id: "msg_answer", text: "Fixed and verified.".repeat(2_000) },
      attempt: 1,
      tools: { total: 0, calls: [] },
      tasks: [],
      goal: undefined,
    })
    expect(input).toMatchObject({
      operation: "response_quality",
      kind: "gate",
      subjectID: "msg_request",
      candidateID: "msg_answer",
      attempt: 1,
    })
    expect(JSON.stringify(input.candidate).length).toBeLessThan(8_000)
    expect(Object.keys(input.questions)).not.toContain("tool_evidence")
  })

  test("each gate declares the facts it reads, and the record carries the subject slices read", () => {
    const workspace = {
      files: ["src/a.ts", "src/b.ts"],
      todos: {
        counts: { pending: 2, in_progress: 1, blocked: 0, completed: 3, cancelled: 0 },
        working: [{ key: "t1", label: "Fix the engine" }],
        blocked: [],
        next: [],
      },
      goal: { status: "active", stopAfter: "plan", objective: "fix it" },
      heading: "2 files changed · working on Fix the engine · goal active",
    }
    const input = IntelligenceResponse.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: "Fix the build" },
      candidate: { id: "msg_answer", text: "Fixed." },
      attempt: 1,
      tools: { total: 2, calls: [] },
      tasks: [{ content: "fix" }],
      goal: { objective: "fix it" },
      workspace,
    })
    // Every gate declares what it reads; a description maps to the fact's reference.
    expect(input.questions.correctness?.sources).toEqual({ "files this session changed": "workspace.files" })
    expect(input.questions.tool_evidence?.sources).toEqual({ "bounded tool results": "tools" })
    expect(input.questions.writing?.sources).toBeUndefined()
    // The record exposes, per subject, the bounded slice that subject's gates judge against.
    expect(input.read).toEqual({
      work_claims: { files: ["src/a.ts", "src/b.ts"], todos: workspace.todos.counts },
      completeness: { todos: workspace.todos.counts, goal: "active" },
    })
    // Without a snapshot nothing is declared beyond the per-gate sources and no slice is recorded.
    const plain = IntelligenceResponse.evaluation({
      sessionID: "ses_test",
      request: { id: "msg_request", text: "Fix the build" },
      candidate: { id: "msg_answer", text: "Fixed." },
      attempt: 1,
      tools: { total: 0, calls: [] },
      tasks: [],
      goal: undefined,
    })
    expect(plain.read).toBeUndefined()
    expect(plain.sources).not.toHaveProperty("workspace")
  })

  test("repairs only established issues, each once, and keeps what remains unresolved", () => {
    const evaluation = review("needs_revision", { unsupported: 0.8, writing: 0.5, omission: 0.05 })
    expect(IntelligenceResponse.verdict(evaluation, [])).toEqual({
      repair: ["unsupported"],
      unresolved: ["unsupported"],
    })
    expect(IntelligenceResponse.verdict(evaluation, ["unsupported"])).toEqual({
      repair: [],
      unresolved: ["unsupported"],
    })
    expect(IntelligenceResponse.verdict(review("unavailable", {}), [])).toEqual({ repair: [], unresolved: [] })
    expect(IntelligenceResponse.verdict(undefined, [])).toEqual({ repair: [], unresolved: [] })
    expect(IntelligenceResponse.confidence(evaluation, ["unsupported"])).toEqual({ unsupported: 0.8 })
  })

  test("asks for the whole response again without mentioning the review", () => {
    const prompt = IntelligenceResponse.repairPrompt(["omission", "refusal"])
    expect(prompt).toContain("omission (missed part of the request)")
    expect(prompt).toContain("without a safety disclaimer")
    expect(prompt).toContain("do not acknowledge or mention this review")
  })

  test("recognizes an unchanged revision in any script", () => {
    expect(IntelligenceResponse.same("Done! All tests pass.", "done, all tests pass")).toBe(true)
    expect(IntelligenceResponse.same("すべてのテストが成功しました", "すべてのテストが成功しました。")).toBe(true)
    expect(IntelligenceResponse.same("すべてのテストが成功しました", "ビルドが失敗しました")).toBe(false)
    expect(IntelligenceResponse.same("", "Something new")).toBe(false)
  })

  test("describes how the review ended for surfaces and for the model", () => {
    const unresolved = IntelligenceResponse.note({
      status: "unresolved",
      evaluationID: "review",
      issues: ["unsupported"],
      confidence: { unsupported: 0.82 },
      revised: true,
    })
    expect(unresolved.description).toBe(
      "S1 review unresolved after revision: 82% sure the answer claimed work it could not prove",
    )
    expect(unresolved.text).toContain("has not been verified")
    const unavailable = IntelligenceResponse.note({ status: "unavailable", detail: "timeout", revised: false })
    expect(unavailable.description).toContain("not verified")
    expect(unavailable.text).toContain("timeout")
    expect(IntelligenceResponse.note({ status: "revised", issues: ["omission"] }).description).toBe(
      "Revised after S1 review: missed part of the request",
    )
  })
})
