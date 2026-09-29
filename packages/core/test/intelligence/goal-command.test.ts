import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { IntelligenceGoalCommand } from "@opencode/core/intelligence/goal-command"

const reading = (
  choice: string,
  confidence: number,
  probabilities: Record<string, number>,
  decision: Intelligence.Evaluation["decision"] = "accepted",
): Intelligence.Evaluation => ({
  id: "evaluation",
  fingerprint: "fingerprint",
  sessionID: "ses_test",
  operation: "goal_command",
  kind: "classification",
  policy: IntelligenceEvaluation.POLICY,
  decision,
  model: "jev",
  answers: { action: { type: "choice", choice, confidence, probabilities } },
  issues: [],
  created: 0,
  duration: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
})

const unavailable: Intelligence.Evaluation = {
  ...reading("set", 1, { set: 1 }, "unavailable"),
  answers: {},
  issues: ["Evaluation unavailable: timeout. Previous state preserved."],
}

describe("IntelligenceGoalCommand.parse", () => {
  test("the bare command opens the status", () => {
    expect(IntelligenceGoalCommand.parse("")).toEqual({ type: "menu" })
    expect(IntelligenceGoalCommand.parse("   ")).toEqual({ type: "menu" })
  })

  test("explicit subcommands resolve without System One, in any case", () => {
    expect(IntelligenceGoalCommand.parse("pause")).toEqual({ type: "action", action: "pause", argument: "" })
    expect(IntelligenceGoalCommand.parse(" Resume ")).toEqual({ type: "action", action: "resume", argument: "" })
    expect(IntelligenceGoalCommand.parse("DROP")).toEqual({ type: "action", action: "drop", argument: "" })
    expect(IntelligenceGoalCommand.parse("status")).toEqual({ type: "action", action: "status", argument: "" })
    expect(IntelligenceGoalCommand.parse("budget")).toEqual({ type: "action", action: "budget", argument: "" })
    expect(IntelligenceGoalCommand.parse("set make the tests pass")).toEqual({
      type: "action",
      action: "set",
      argument: "make the tests pass",
    })
    expect(IntelligenceGoalCommand.parse("budget $5")).toEqual({ type: "action", action: "budget", argument: "$5" })
  })

  test("a control word followed by more text is free text, never a control", () => {
    expect(IntelligenceGoalCommand.parse("drop support for Node 16")).toEqual({
      type: "text",
      text: "drop support for Node 16",
    })
    expect(IntelligenceGoalCommand.parse("pause the CI job on failure")).toEqual({
      type: "text",
      text: "pause the CI job on failure",
    })
  })

  test("any other text is free text, whatever its language", () => {
    expect(IntelligenceGoalCommand.parse("make the tests pass")).toEqual({ type: "text", text: "make the tests pass" })
    expect(IntelligenceGoalCommand.parse("pausa isso por enquanto")).toEqual({
      type: "text",
      text: "pausa isso por enquanto",
    })
    expect(IntelligenceGoalCommand.parse("目標を中止して")).toEqual({ type: "text", text: "目標を中止して" })
  })
})

describe("IntelligenceGoalCommand.budget", () => {
  test("reads dollars before or after the amount", () => {
    expect(IntelligenceGoalCommand.budget("$5")).toEqual({ ok: true, value: { maxCostUsd: 5 } })
    expect(IntelligenceGoalCommand.budget("5$")).toEqual({ ok: true, value: { maxCostUsd: 5 } })
    expect(IntelligenceGoalCommand.budget("2,50$")).toEqual({ ok: true, value: { maxCostUsd: 2.5 } })
  })

  test("reads tokens", () => {
    expect(IntelligenceGoalCommand.budget("200k tokens")).toEqual({ ok: true, value: { maxTokens: 200_000 } })
    expect(IntelligenceGoalCommand.budget("1.5m")).toEqual({ ok: true, value: { maxTokens: 1_500_000 } })
  })

  test("maps turns and steps onto the goal's step budget", () => {
    expect(IntelligenceGoalCommand.budget("40 turns")).toEqual({ ok: true, value: { maxTurns: 40 } })
    expect(IntelligenceGoalCommand.budget("40 steps")).toEqual({ ok: true, value: { maxTurns: 40 } })
    expect(IntelligenceGoalCommand.budget("40")).toEqual({ ok: true, value: { maxTurns: 40 } })
  })

  test("combines limits and clears the spend limits with off", () => {
    expect(IntelligenceGoalCommand.budget("40 turns $3 200k")).toEqual({
      ok: true,
      value: { maxTurns: 40, maxCostUsd: 3, maxTokens: 200_000 },
    })
    expect(IntelligenceGoalCommand.budget("off")).toEqual({ ok: true, value: { maxCostUsd: null, maxTokens: null } })
  })

  test("rejects prose and step budgets over the limit", () => {
    expect(IntelligenceGoalCommand.budget("a bit more money").ok).toBe(false)
    expect(IntelligenceGoalCommand.budget("").ok).toBe(false)
    expect(IntelligenceGoalCommand.budget(`${IntelligenceGoalCommand.MAX_STEPS + 1} turns`).ok).toBe(false)
  })
})

describe("IntelligenceGoalCommand.menu", () => {
  test("offers the actions that apply to the goal's state, the likely next step first", () => {
    expect(IntelligenceGoalCommand.menu(undefined)).toEqual(["set"])
    expect(IntelligenceGoalCommand.menu("active")[0]).toBe("pause")
    expect(IntelligenceGoalCommand.menu("waiting")[0]).toBe("pause")
    expect(IntelligenceGoalCommand.menu("paused")[0]).toBe("resume")
    expect(IntelligenceGoalCommand.menu("blocked")[0]).toBe("resume")
    expect(IntelligenceGoalCommand.menu("done")).toEqual(["set", "drop"])
  })
})

describe("IntelligenceGoalCommand.decide", () => {
  test("drops or replaces an unfinished goal only at 85% or more", () => {
    expect(IntelligenceGoalCommand.decide(reading("drop", 0.9, { drop: 0.9, pause: 0.1 }), "active")).toEqual({
      action: "drop",
      options: [],
      confidence: 0.9,
    })
    expect(IntelligenceGoalCommand.decide(reading("drop", 0.84, { drop: 0.84, pause: 0.16 }), "active")).toEqual({
      options: ["drop", "pause", "set"],
      confidence: 0.84,
    })
    expect(IntelligenceGoalCommand.decide(reading("set", 0.8, { set: 0.8, pause: 0.2 }), "paused")).toEqual({
      options: ["set", "pause", "resume"],
      confidence: 0.8,
    })
    expect(IntelligenceGoalCommand.decide(reading("set", 0.85, { set: 0.85, drop: 0.15 }), "blocked").action).toBe(
      "set",
    )
  })

  test("acts on other readings at 70% or more", () => {
    expect(IntelligenceGoalCommand.decide(reading("pause", 0.7, { pause: 0.7, drop: 0.3 }), "active").action).toBe(
      "pause",
    )
    expect(IntelligenceGoalCommand.decide(reading("set", 0.7, { set: 0.7, status: 0.3 }), "done").action).toBe("set")
    expect(IntelligenceGoalCommand.decide(reading("set", 0.7, { set: 0.7, status: 0.3 }), undefined).action).toBe("set")
    expect(IntelligenceGoalCommand.decide(reading("pause", 0.6, { pause: 0.6, resume: 0.4 }), "active")).toEqual({
      options: ["pause", "resume", "set"],
      confidence: 0.6,
    })
  })

  test("without a reading, the text is the goal only when no goal is unfinished", () => {
    expect(IntelligenceGoalCommand.decide(undefined, undefined)).toEqual({ action: "set", options: [] })
    expect(IntelligenceGoalCommand.decide(unavailable, "done")).toEqual({ action: "set", options: [] })
    expect(IntelligenceGoalCommand.decide(undefined, "active")).toEqual({ options: ["set", "pause"] })
    expect(IntelligenceGoalCommand.decide(unavailable, "waiting")).toEqual({ options: ["set", "pause"] })
    expect(IntelligenceGoalCommand.decide(undefined, "paused")).toEqual({ options: ["set", "resume"] })
    expect(IntelligenceGoalCommand.decide(reading("other", 0.99, { other: 0.99, set: 0.01 }), "blocked")).toEqual({
      options: ["set", "resume"],
    })
  })
})

describe("IntelligenceGoalCommand.resolve", () => {
  const never = Effect.die("System One must not be asked")

  test("explicit subcommands and the bare command never ask System One", () => {
    expect(
      Effect.runSync(IntelligenceGoalCommand.resolve({ text: "pause", status: "active", classify: never })),
    ).toEqual({
      action: "pause",
      options: [],
    })
    expect(Effect.runSync(IntelligenceGoalCommand.resolve({ text: "", status: "active", classify: never }))).toEqual({
      action: "status",
      options: [],
    })
  })

  test("free text follows System One's reading and asks when it fails", () => {
    expect(
      Effect.runSync(
        IntelligenceGoalCommand.resolve({
          text: "pausa isso por enquanto",
          status: "active",
          classify: Effect.succeed(reading("pause", 0.92, { pause: 0.92, drop: 0.08 })),
        }),
      ),
    ).toEqual({ action: "pause", options: [], confidence: 0.92 })
    expect(
      Effect.runSync(
        IntelligenceGoalCommand.resolve({
          text: "esquece esse objetivo",
          status: "active",
          classify: Effect.fail(new IntelligenceEvaluation.Error({ message: "timeout" })),
        }),
      ),
    ).toEqual({ options: ["set", "pause"] })
  })

  test("the classification input carries the text and the goal as evidence", () => {
    const input = IntelligenceGoalCommand.evaluation({
      sessionID: "ses_test",
      text: "pausa isso por enquanto",
      goal: { id: "goal_1", status: "active", objective: "make the tests pass" },
    })
    expect(input).toMatchObject({
      operation: "goal_command",
      kind: "classification",
      subjectID: "goal_1",
      sources: { request: "pausa isso por enquanto", goal: { status: "active", objective: "make the tests pass" } },
    })
    expect(Object.keys(input.questions)).toEqual(["action"])
  })
})
