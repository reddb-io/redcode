import { describe, expect, test } from "bun:test"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { IntelligenceSubagentReview } from "@opencode/core/intelligence/subagent-review"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"

const evaluation = (
  decision: "accepted" | "needs_revision" | "inconclusive" | "unavailable",
  issues: string[] = [],
) => ({
  id: "evaluation",
  decision,
  issues,
})

const edit = (filePath: string) => ({
  type: "tool",
  tool: "edit",
  callID: `call-${filePath}`,
  state: { status: "completed", input: { filePath }, output: "edited" },
})

const shell = (command: string, exit: number) => ({
  type: "tool",
  tool: "shell",
  callID: `call-${command}-${exit}`,
  state: { status: "completed", input: { command }, output: "", metadata: { exit } },
})

describe("IntelligenceSubagentReview brief", () => {
  test("flags what the structured fields leave out and blocks only an empty prompt", () => {
    expect(IntelligenceSubagentReview.briefStructure({ prompt: "   ", writeCapable: true })).toEqual([
      expect.objectContaining({ id: "empty_prompt", blocking: true }),
    ])
    expect(
      IntelligenceSubagentReview.briefStructure({ prompt: "fix it", writeCapable: true }).map((finding) => [
        finding.id,
        finding.blocking,
      ]),
    ).toEqual([
      ["short_prompt", false],
      ["missing_done_criteria", false],
      ["missing_return_format", false],
      ["missing_scope", false],
    ])
    expect(
      IntelligenceSubagentReview.briefStructure({
        prompt: "Find every caller of the session loader and report where each one lives.",
        doneCriteria: ["every caller is listed"],
        returnFormat: "file:line list",
        writeCapable: false,
      }),
    ).toEqual([])
  })

  test("measures a short prompt in code points, the same in every script", () => {
    const ideographs =
      "会話履歴を読み込む関数のすべての呼び出し元を探して、それぞれの場所を報告してください。理由も一行で添えてください。"
    expect(
      IntelligenceSubagentReview.briefStructure({ prompt: ideographs, writeCapable: false }).map(
        (finding) => finding.id,
      ),
    ).not.toContain("short_prompt")
  })

  test("maps the S1 answer to launching, repairing or proceeding with a warning", () => {
    const findings = IntelligenceSubagentReview.briefStructure({ prompt: "fix it", writeCapable: false })
    const blocked = IntelligenceSubagentReview.briefVerdict({
      findings: IntelligenceSubagentReview.briefStructure({ prompt: "", writeCapable: false }),
      single: false,
      rejectedBefore: false,
    })
    expect(blocked).toMatchObject({ launch: false, review: { verdict: "needs_revision", issues: ["empty_prompt"] } })

    // Single reasoning skips the semantic review: it launches, recorded as unverified, with no note.
    const single = IntelligenceSubagentReview.briefVerdict({ findings, single: true, rejectedBefore: false })
    expect(single).toMatchObject({ launch: true, review: { verdict: "unverified" } })
    expect(IntelligenceSubagentReview.note(single.review)).toBeUndefined()

    const unavailable = IntelligenceSubagentReview.briefVerdict({ findings, single: false, rejectedBefore: false })
    expect(unavailable).toMatchObject({
      launch: true,
      review: { verdict: "inconclusive", unavailable: "System One is not enabled" },
    })
    expect(IntelligenceSubagentReview.note(unavailable.review)).toContain("it started unverified")

    const accepted = IntelligenceSubagentReview.briefVerdict({
      findings,
      single: false,
      evaluation: evaluation("accepted"),
      rejectedBefore: false,
    })
    expect(accepted).toMatchObject({ launch: true, review: { verdict: "verified", evaluationID: "evaluation" } })
    expect(IntelligenceSubagentReview.note(accepted.review)).toBeUndefined()

    const first = IntelligenceSubagentReview.briefVerdict({
      findings,
      single: false,
      evaluation: evaluation("needs_revision", ["missing_done_criteria"]),
      rejectedBefore: false,
    })
    expect(first.launch).toBe(false)
    const rejection = IntelligenceSubagentReview.rejection("general", first.review)
    expect(rejection).toContain("nothing was launched")
    expect(rejection).toContain("Pass it in done_criteria.")

    const second = IntelligenceSubagentReview.briefVerdict({
      findings,
      single: false,
      evaluation: evaluation("needs_revision", ["missing_done_criteria"]),
      rejectedBefore: true,
    })
    expect(second).toMatchObject({ launch: true, review: { verdict: "needs_revision" } })
    expect(IntelligenceSubagentReview.note(second.review)).toContain("started after one revision")
  })

  test("asks S1 whether the user wanted a model only when the brief picks one", () => {
    const input = {
      sessionID: "ses_parent",
      subjectID: "msg_request:general",
      attempt: 0,
      requests: ["Review the loader"],
      agent: { name: "general", writeCapable: false },
      findings: [],
      description: "review",
      brief: { prompt: "Review the loader", writeCapable: false },
    }
    expect(Object.keys(IntelligenceSubagentReview.briefEvaluation(input).questions)).not.toContain(
      "model_not_requested",
    )
    expect(
      Object.keys(IntelligenceSubagentReview.briefEvaluation({ ...input, model: "test/other" }).questions),
    ).toContain("model_not_requested")
  })

  test("renders the structured half of the brief after the prompt", () => {
    expect(IntelligenceSubagentReview.instructions({ scope: [" "], criteria: [] })).toBeUndefined()
    expect(
      IntelligenceSubagentReview.instructions({
        scope: ["src/**"],
        criteria: ["tests pass"],
        returnFormat: "a diff summary",
      }),
    ).toBe(
      [
        "<brief>",
        "Scope: change only files matching these globs, and read outside them only for context.",
        "- src/**",
        "Done criteria: finish only when each holds, and report the evidence for each.",
        "- tests pass",
        "Return format: a diff summary",
        "</brief>",
      ].join("\n"),
    )
  })
})

describe("IntelligenceSubagentReview result", () => {
  test("finds changes outside the scope, relative or absolute", () => {
    const parts = [edit("/repo/src/a.ts"), edit("/repo/docs/b.md"), edit("/elsewhere/c.ts")]
    expect(IntelligenceSubagentReview.outOfScope(parts, ["src/**"], "/repo")).toEqual([
      "/repo/docs/b.md",
      "/elsewhere/c.ts",
    ])
    expect(IntelligenceSubagentReview.outOfScope(parts, ["src", "docs", "/elsewhere"], "/repo")).toEqual([])
    expect(IntelligenceSubagentReview.outOfScope(parts, [], "/repo")).toEqual([])
  })

  test("keeps only the latest run of a verification command", () => {
    expect(IntelligenceSubagentReview.failingVerifications([shell("bun test", 1), shell("bun test", 0)])).toEqual([])
    expect(IntelligenceSubagentReview.failingVerifications([shell("bun test", 0), shell("bun test", 2)])).toEqual([
      { command: "bun test", exit: 2, failed: true },
    ])
  })

  test("blocks an empty result and a change outside the scope, and only advises otherwise", () => {
    const brief = { criteria: ["the loader tests pass"], scope: ["src/**"], changesRequested: true, directory: "/repo" }
    expect(IntelligenceSubagentReview.resultChecks({ text: " ", parts: [] }, brief)).toEqual([
      expect.objectContaining({ id: "empty_result", blocking: true }),
    ])
    const findings = IntelligenceSubagentReview.resultChecks(
      { text: "Done.", parts: [edit("/repo/docs/b.md"), shell("bun test", 1)] },
      brief,
    )
    expect(findings.map((finding) => [finding.id, finding.blocking])).toEqual([
      ["criteria_not_mentioned", false],
      ["out_of_scope", true],
      ["failing_verification", false],
    ])
    expect(
      IntelligenceSubagentReview.resultChecks(
        { text: "The loader tests pass: bun test exited 0.", parts: [edit("/repo/src/a.ts"), shell("bun test", 0)] },
        brief,
      ),
    ).toEqual([])
  })

  test("never accepts a result S1 did not check", () => {
    const advisory = [{ id: "criteria_not_mentioned", blocking: false, message: "criteria" }]
    const blocking = [{ id: "out_of_scope", blocking: true, message: "scope" }]
    expect(IntelligenceSubagentReview.judge({ findings: advisory, single: true, repaired: false })).toMatchObject({
      decision: "unverified",
      issues: ["criteria_not_mentioned"],
    })
    expect(
      IntelligenceSubagentReview.judge({
        findings: blocking,
        evaluation: evaluation("accepted"),
        single: false,
        repaired: false,
      }),
    ).toMatchObject({ decision: "needs_revision", issues: ["out_of_scope"] })
    expect(IntelligenceSubagentReview.judge({ findings: [], single: false, repaired: true })).toMatchObject({
      decision: "unverified",
      repaired: true,
      unavailable: "System One is not enabled",
    })
    expect(
      IntelligenceSubagentReview.judge({
        findings: [],
        evaluation: evaluation("unavailable", ["Evaluation unavailable: timeout. Previous state preserved."]),
        single: false,
        repaired: false,
      }),
    ).toMatchObject({ decision: "unverified", unavailable: "Evaluation unavailable: timeout." })
    expect(
      IntelligenceSubagentReview.judge({
        findings: advisory,
        evaluation: evaluation("accepted"),
        single: false,
        repaired: false,
      }),
    ).toMatchObject({ decision: "verified", issues: [], evaluationID: "evaluation" })
    expect(
      IntelligenceSubagentReview.judge({
        findings: [],
        evaluation: evaluation("inconclusive", ["claim_without_evidence"]),
        single: false,
        repaired: false,
      }),
    ).toMatchObject({ decision: "inconclusive", issues: ["claim_without_evidence"] })
  })

  test("tells the parent how to read each verdict and the subagent how to repair", () => {
    const review = IntelligenceSubagentReview.judge({
      findings: [],
      evaluation: evaluation("needs_revision", ["unmet_criterion", "1:unmet_criterion"]),
      single: false,
      repaired: true,
    })
    expect(IntelligenceSubagentReview.reviewBlock(review)).toStartWith(
      '<review decision="needs_revision" repaired="true">',
    )
    expect(IntelligenceSubagentReview.repair(review)).toStartWith(IntelligenceSubagentReview.REPAIR)
    expect(IntelligenceSubagentReview.repair(review).match(/Meet every done criterion/g)).toHaveLength(1)
    expect(IntelligenceSubagentReview.stoppedBlock("S1 · no progress for 9 steps")).toContain(
      '<review decision="unverified" stopped="true">',
    )
    expect(IntelligenceSubagentReview.recorded(review, 5)).toEqual({
      decision: "needs_revision",
      issues: ["unmet_criterion", "1:unmet_criterion"],
      repaired: true,
      evaluationID: "evaluation",
      at: 5,
    })
  })
})

describe("SubagentReview metadata", () => {
  test("keeps the brief next to the other metadata and reads the verdict back", () => {
    const brief: SubagentReview.Brief = {
      prompt: "Review the loader",
      agent: "general",
      scope: ["src/**"],
      criteria: [],
      writeCapable: true,
      parentSessionID: "ses_parent",
      verdict: "verified",
      issues: [],
      created: 1,
      result: { decision: "needs_revision", issues: ["unmet_criterion"], repaired: true, at: 2 },
    }
    const metadata = SubagentReview.write({ budget: { maxTokens: 10 } }, brief)
    expect(metadata.budget).toEqual({ maxTokens: 10 })
    expect(SubagentReview.read(metadata)).toEqual(brief)
    expect(SubagentReview.supervised(SubagentReview.read(metadata))).toBe(true)
    expect(SubagentReview.supervised({ ...brief, scope: [] })).toBe(false)
    expect(SubagentReview.decision({ review: { decision: "verified" } }, metadata)).toBe("verified")
    expect(SubagentReview.decision({}, metadata)).toBe("needs_revision")
    expect(SubagentReview.read({ [SubagentReview.METADATA_KEY]: { prompt: 1 } })).toBeUndefined()
  })

  test("reads stop-loss checkpoints and where the latest left the subagent", () => {
    const hint = SubagentReview.checkpoint({ metadata: { stopLoss: { action: "steer", line: "S1 · looping" } } }, 1)
    const stop = SubagentReview.checkpoint({ metadata: { stopLoss: { action: "stop", line: "S1 · no progress" } } }, 2)
    expect(SubagentReview.checkpoint({ metadata: { stopLoss: { action: "continue", line: "x" } } }, 3)).toBeUndefined()
    expect(SubagentReview.checkpointState([])).toEqual({ type: "in_scope" })
    expect(SubagentReview.checkpointState([hint!])).toEqual({ type: "corrected", line: "S1 · looping" })
    expect(SubagentReview.checkpointState([hint!, stop!])).toEqual({ type: "stopped", line: "S1 · no progress" })
  })
})

describe("SubagentTool caps", () => {
  test("defaults to the legacy caps and reads configured ones", () => {
    expect(SubagentTool.limits([])).toEqual(SubagentTool.LIMITS)
  })

  test("takes slots up to the cap in one step and frees them", () => {
    const slots = new Map<string, Set<string>>()
    expect(SubagentTool.admit(slots, "ses_parent", "a", 2)).toBeUndefined()
    expect(SubagentTool.admit(slots, "ses_parent", "b", 2)).toBeUndefined()
    expect(SubagentTool.admit(slots, "ses_parent", "c", 2)).toBe(2)
    expect(SubagentTool.admit(slots, "ses_other", "c", 2)).toBeUndefined()
    SubagentTool.release(slots, "ses_parent", "a")
    expect(SubagentTool.admit(slots, "ses_parent", "c", 2)).toBeUndefined()
    SubagentTool.release(slots, "ses_parent", "b")
    SubagentTool.release(slots, "ses_parent", "c")
    expect(slots.has("ses_parent")).toBe(false)
  })

  test("names the cap and what to do instead", () => {
    expect(SubagentTool.refusal("concurrent", 4, 4)).toContain(
      "4 foreground subagents are already running for this session (limit 4, experimental.subagent_limits.concurrent)",
    )
    expect(SubagentTool.refusal("background", 1, 1)).toContain("run this task in the foreground")
    expect(SubagentTool.refusal("per_request", 12, 12)).toContain("continue one with its sessionID")
  })
})
