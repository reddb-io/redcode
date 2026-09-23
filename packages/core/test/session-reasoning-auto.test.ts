import { afterEach, describe, expect, test } from "bun:test"
import type { Router } from "@reddb-io/redcode-schema/router"
import { ReasoningAuto } from "../src/session/reasoning-auto"
import { LOOP_GUARD_REFUSAL } from "../src/session/loop-marker"

const OPENAI = ["none", "minimal", "low", "medium", "high", "xhigh"]

// One user turn: the decision for its first request, from what the previous turn left behind.
const turn = (input: Partial<ReasoningAuto.Input> & { readonly turnID: string }) =>
  ReasoningAuto.decideEffort({ variants: OPENAI, ...input })!

describe("ReasoningAuto.decideEffort", () => {
  test.each<[number, ReasoningAuto.Level]>([
    [0, "minimal"],
    [0.14, "minimal"],
    [0.15, "low"],
    [0.34, "low"],
    [0.35, "medium"],
    [0.59, "medium"],
    [0.6, "high"],
    [0.79, "high"],
    [0.8, "xhigh"],
    [1, "xhigh"],
  ])("deliberation %d starts at %s", (unit, level) => {
    expect(turn({ turnID: "u1", assessment: { complexity: unit, consequence: 0 } })).toMatchObject({
      level,
      cause: "assessment",
    })
    // The greater of complexity and consequence decides, as the router hint's deliberation does.
    expect(turn({ turnID: "u1", assessment: { complexity: 0, consequence: unit } }).level).toBe(level)
  })

  test("without an assessment the first turn is medium and later turns keep their level (fail open)", () => {
    const first = turn({ turnID: "u1" })
    expect(first).toMatchObject({ level: "medium", cause: "default" })
    const high = turn({ turnID: "u2", previous: { ...first.state, level: "high", changedAt: -5 } })
    expect(high).toMatchObject({ level: "high", cause: "kept" })
  })

  test.each<[string, ReasoningAuto.Assessment, string, string]>([
    ["corrects", { complexity: 0.5, feedback: "corrects" }, "high", "feedback"],
    ["rejects", { complexity: 0.5, feedback: "rejects" }, "high", "feedback"],
    ["frustration at 2/3", { complexity: 0.5, frustration: 2 / 3 }, "high", "frustration"],
    ["frustration below 2/3", { complexity: 0.5, frustration: 0.5 }, "medium", "assessment"],
    ["agrees", { complexity: 0.5, feedback: "agrees" }, "low", "assessment+agrees"],
    ["neutral", { complexity: 0.5, feedback: "neutral" }, "medium", "assessment"],
    ["a question to ask first", { complexity: 0.5, mustClarify: 0.9 }, "low", "assessment+clarify"],
    ["a blocked person", { complexity: 0.1, impact: 2 / 3 }, "medium", "impact"],
  ])("%s", (_name, assessment, level, cause) => {
    expect(turn({ turnID: "u1", assessment })).toMatchObject({ level, cause })
  })

  test("a heavy context adds one step, never on top of trouble", () => {
    const heavy = { tokens: 60_000, window: 100_000 }
    expect(turn({ turnID: "u1", assessment: { complexity: 0.5 }, context: heavy })).toMatchObject({
      level: "high",
      cause: "context",
    })
    expect(
      turn({ turnID: "u1", assessment: { complexity: 0.5 }, context: { tokens: 40_000, window: 100_000 } }).level,
    ).toBe("medium")
    // Tool definitions the count leaves out tip it over.
    expect(
      turn({ turnID: "u1", assessment: { complexity: 0.5 }, context: { tokens: 45_000, window: 100_000, tools: 40 } })
        .level,
    ).toBe("high")
    expect(turn({ turnID: "u1", assessment: { complexity: 0.5, feedback: "rejects" }, context: heavy })).toMatchObject({
      level: "high",
      cause: "feedback",
    })
  })

  test("the plan agent and an explicit request to think get at least high", () => {
    expect(turn({ turnID: "u1", assessment: { complexity: 0 }, plan: true })).toMatchObject({
      level: "high",
      cause: "plan_mode",
    })
    expect(turn({ turnID: "u1", assessment: { complexity: 0 }, text: "Think hard about the migration" })).toMatchObject(
      { level: "high", cause: "explicit_think" },
    )
    expect(turn({ turnID: "u1", assessment: { complexity: 0.9 }, plan: true })).toMatchObject({
      level: "xhigh",
      cause: "assessment",
    })
  })

  test("holds a level for two user turns unless trouble raises it", () => {
    const first = turn({ turnID: "u1", assessment: { complexity: 0.9 } })
    expect(first).toMatchObject({ level: "xhigh", state: { changedAt: 1, turn: 1 } })
    const second = turn({ turnID: "u2", previous: first.state, assessment: { complexity: 0.1 } })
    expect(second).toMatchObject({ level: "xhigh", cause: "dwell", state: { turn: 2, changedAt: 1 } })
    const third = turn({ turnID: "u3", previous: second.state, assessment: { complexity: 0.1 } })
    expect(third).toMatchObject({ level: "minimal", cause: "assessment", state: { turn: 3, changedAt: 3 } })
    // Rising for trouble skips the dwell; rising without it waits.
    const rejected = turn({ turnID: "u4", previous: third.state, assessment: { complexity: 0.1, feedback: "rejects" } })
    expect(rejected).toMatchObject({ level: "low", cause: "feedback" })
    const calm = turn({ turnID: "u4", previous: third.state, assessment: { complexity: 0.9 } })
    expect(calm).toMatchObject({ level: "minimal", cause: "dwell" })
  })

  test("inside a user turn the level holds, save one step up per turn on trouble", () => {
    const start = turn({ turnID: "u1", assessment: { complexity: 0.5 } })
    const quiet = turn({ turnID: "u1", previous: start.state, assessment: { complexity: 0.95 } })
    expect(quiet).toMatchObject({ level: "medium", cause: "hold" })
    const guarded = turn({ turnID: "u1", previous: quiet.state, progress: { loopGuard: true } })
    expect(guarded).toMatchObject({ level: "high", cause: "loop_guard", state: { loopStep: true } })
    const again = turn({ turnID: "u1", previous: guarded.state, progress: { failureStreak: 5 } })
    expect(again).toMatchObject({ level: "high", cause: "hold" })
    // The next user turn may step up again, and starts with its own allowance.
    const next = turn({ turnID: "u2", previous: again.state, assessment: { complexity: 0.5 } })
    expect(next.state.loopStep).toBe(false)
  })

  test.each<[ReasoningAuto.Progress, string]>([
    [{ loopGuard: true }, "loop_guard"],
    [{ failureStreak: 2 }, "tool_error"],
    [{ toolIssues: true }, "tool_review"],
    [{ repair: true }, "repair"],
  ])("%j steps up inside the turn as %s", (progress, cause) => {
    const start = turn({ turnID: "u1", assessment: { complexity: 0.5 } })
    expect(turn({ turnID: "u1", previous: start.state, progress })).toMatchObject({ level: "high", cause })
  })

  test("a single failure is not trouble", () => {
    const start = turn({ turnID: "u1", assessment: { complexity: 0.5 } })
    expect(turn({ turnID: "u1", previous: start.state, progress: { failureStreak: 1 } }).cause).toBe("hold")
  })

  test("chooses only the model's own variants, within the configured bounds", () => {
    // Anthropic budget variants: only high inside the default bounds.
    expect(
      ReasoningAuto.decideEffort({ variants: ["high", "max"], turnID: "u1", assessment: { complexity: 0 } }),
    ).toMatchObject({ level: "high" })
    // A missing level snaps to the nearest, a tie to more thought.
    expect(
      ReasoningAuto.decideEffort({ variants: ["low", "high"], turnID: "u1", assessment: { complexity: 0.5 } })?.level,
    ).toBe("high")
    expect(
      ReasoningAuto.decideEffort({
        variants: OPENAI,
        turnID: "u1",
        assessment: { complexity: 1 },
        ceiling: "medium",
        floor: "low",
      })?.level,
    ).toBe("medium")
    expect(
      ReasoningAuto.decideEffort({ variants: OPENAI, turnID: "u1", assessment: { complexity: 0 }, floor: "none" })
        ?.level,
    ).toBe("minimal")
    expect(ReasoningAuto.decideEffort({ variants: ["fast", "thinking"], turnID: "u1" })).toBeUndefined()
    // Never `auto` itself.
    expect(ReasoningAuto.decideEffort({ variants: ["auto", "low", "high"], turnID: "u1" })?.level).not.toBe("auto")
  })
})

describe("ReasoningAuto signals", () => {
  test.each<[string, boolean]>([
    ["Think hard about this", true],
    ["please THINK CAREFULLY before editing", true],
    ["ultrathink", true],
    ["Pense bem antes de mudar", true],
    ["pensa com cuidado nisso", true],
    ["analise com cuidado o log", true],
    ["I think hardware is fine", false],
    ["rethink hard coded values", false],
    ["```\nthink hard\n```", false],
    ["the `think hard` flag", false],
    ["", false],
  ])("%j explicitly asks for thought: %s", (text, expected) => {
    expect(ReasoningAuto.explicitThink(text)).toBe(expected)
  })

  test("reads loop guard corrections and the failure streak from the turn", () => {
    const tool = (status: "completed" | "error", text: string) => ({
      type: "tool",
      tool: "bash",
      state: status === "error" ? { status, error: text } : { status, output: text },
    })
    expect(
      ReasoningAuto.progress([tool("error", "a"), tool("completed", "ok"), tool("error", "b"), tool("error", "c")]),
    ).toEqual({ loopGuard: false, failureStreak: 2 })
    expect(
      ReasoningAuto.progress([tool("error", `${LOOP_GUARD_REFUSAL}3 of \`bash\``), { type: "text", text: "hm" }]),
    ).toEqual({ loopGuard: true, failureStreak: 1 })
    expect(ReasoningAuto.stalled({ failureStreak: 2 })).toBe(true)
    expect(ReasoningAuto.stalled({ failureStreak: 1 })).toBe(false)
    expect(ReasoningAuto.stalled(undefined)).toBe(false)
  })

  test("offers auto only for models with two effort levels at least", () => {
    expect(ReasoningAuto.options(["low", "high"])).toEqual(["auto", "low", "high"])
    expect(ReasoningAuto.options(["high"])).toEqual(["high"])
    expect(ReasoningAuto.options(["fast", "thinking"])).toEqual(["fast", "thinking"])
    expect(ReasoningAuto.options(["auto", "low", "high"])).toEqual(["auto", "low", "high"])
  })
})

describe("ReasoningAuto.coordinate", () => {
  const router = (features: Router.Feature[]): Router.Detection => ({ kind: "red-router", features, checkedAt: 0 })
  const current = router(["hint", "reasoning", "reasoning-auto", "hint-signals"])

  test.each<[string, ReasoningAuto.Route, Router.Detection | undefined, boolean, ReasoningAuto.Coordination]>([
    [
      "dual, direct model",
      { auto: true, dual: true, level: "high" },
      current,
      false,
      { decider: "redcode", header: "off", hint: false },
    ],
    [
      "dual, combo",
      { auto: true, dual: true, level: "high" },
      current,
      true,
      { decider: "redcode", header: "high", hint: false },
    ],
    [
      "single, router accepts auto",
      { auto: true, dual: false, level: "medium" },
      current,
      false,
      { decider: "router", header: "auto", hint: true },
    ],
    [
      "single, older router covering the key",
      { auto: true, dual: false },
      router(["reasoning", "reasoning-applies"]),
      false,
      { decider: "router", hint: true },
    ],
    [
      "single, router without autopilot",
      { auto: true, dual: false, level: "low" },
      router(["reasoning"]),
      false,
      { decider: "redcode", header: "off", hint: false },
    ],
    ["manual variant", { auto: false, dual: true }, current, true, { decider: "none", header: "off", hint: false }],
    [
      "manual variant, single",
      { auto: false, dual: false },
      current,
      false,
      { decider: "none", header: "off", hint: false },
    ],
    ["alone, dual", { auto: true, dual: true, level: "high" }, undefined, false, { decider: "redcode", hint: false }],
    [
      "alone, single",
      { auto: true, dual: false },
      { kind: "none", features: [], checkedAt: 0 },
      false,
      { decider: "redcode", hint: false },
    ],
    [
      "router without reasoning",
      { auto: false, dual: false },
      router(["hint"]),
      false,
      { decider: "none", hint: false },
    ],
  ])("%s", (_name, route, detection, combo, expected) => {
    expect(ReasoningAuto.coordinate(route, detection, combo)).toEqual(expected)
  })
})

describe("ReasoningAuto session state", () => {
  afterEach(() => ReasoningAuto.forget())

  test("adopts the level a deciding router reports, and nothing else", () => {
    const decision = turn({ turnID: "u1", assessment: { complexity: 0.5 } })
    ReasoningAuto.remember("ses_a", decision.state)
    ReasoningAuto.adopt("ses_a", { level: "high", cause: "jev" })
    expect(ReasoningAuto.recall("ses_a")?.level).toBe("medium")
    ReasoningAuto.note("ses_a", "router")
    ReasoningAuto.adopt("ses_a", { level: "turbo" })
    expect(ReasoningAuto.recall("ses_a")?.level).toBe("medium")
    ReasoningAuto.adopt("ses_a", { level: "high", cause: "jev" })
    expect(ReasoningAuto.display(ReasoningAuto.recall("ses_a")!)).toEqual({
      level: "high",
      cause: "jev",
      decider: "router",
    })
    // The router's level is where the next turn starts from.
    expect(turn({ turnID: "u2", previous: ReasoningAuto.recall("ses_a") }).state.decider).toBe("router")
  })
})
