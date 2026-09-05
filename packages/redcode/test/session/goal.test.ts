import { describe, expect, test } from "bun:test"
import { SessionGoal } from "@/session/goal"

const now = 1_700_000_000_000

describe("a goal, parsed", () => {
  test("free text is the objective; fields become the contract; gates are commands", () => {
    const g = SessionGoal.parse(
      "make the design suite pass; verify: bun test test/design; gate: bun test test/design; constraints: do not touch the app; stop when: a test needs the network",
      { now, id: "g1" },
    )
    expect(g.objective).toBe("make the design suite pass")
    expect(g.contract).toEqual({
      verification: "bun test test/design",
      constraints: "do not touch the app",
      stop_when: "a test needs the network",
    })
    expect(g.gates).toEqual(["bun test test/design"])
    expect(g.status).toBe("active")
    expect(g.turns).toEqual({ used: 0, max: SessionGoal.DEFAULT_MAX_TURNS })
  })

  test("one line per field works too, aliases included, and repeated gates accumulate", () => {
    const g = SessionGoal.parse(
      "ship it\nverification: tests green\nscope: packages/redcode only\ngate: bun test a\ngate: bun test b",
      { now },
    )
    expect(g.objective).toBe("ship it")
    expect(g.contract.boundaries).toBe("packages/redcode only")
    expect(g.gates).toEqual(["bun test a", "bun test b"])
  })

  test("a bare sentence is a goal with an empty contract", () => {
    const g = SessionGoal.parse("fix the flaky test", { now, maxTurns: 5 })
    expect(g.objective).toBe("fix the flaky test")
    expect(g.contract).toEqual({})
    expect(g.turns.max).toBe(5)
  })

  test("survives a round trip through metadata, and tolerates junk", () => {
    const g = SessionGoal.parse("x", { now, id: "g" })
    const meta = SessionGoal.toMetadata({ other: 1 }, g)
    expect(SessionGoal.fromMetadata(meta)).toEqual(g)
    expect(SessionGoal.fromMetadata(SessionGoal.toMetadata(meta, undefined))).toBeUndefined()
    expect(
      SessionGoal.fromMetadata({ goal: { id: "g", objective: "x", status: "weird", turns: { max: -1 } } })?.turns.max,
    ).toBe(SessionGoal.DEFAULT_MAX_TURNS)
    expect(SessionGoal.fromMetadata({ goal: "nope" })).toBeUndefined()
  })
})

describe("what the model sees", () => {
  const g = SessionGoal.parse("finish the feature; verify: bun test; gate: bun test", { now })

  test("the per-turn block carries the objective, the turn count, and the sentence against drift", () => {
    const text = SessionGoal.render({ ...g, turns: { used: 2, max: 20 } })
    expect(text).toContain("Turn 3 of 20")
    expect(text).toContain("Objective: finish the feature")
    expect(text).toContain("Verification: bun test")
    expect(text).toContain("Gates (must exit 0")
    expect(text).toContain(SessionGoal.ANTI_DRIFT)
    expect(text).toContain("goal_complete")
  })

  test("a continuation restates the objective verbatim and carries the judge's reason", () => {
    const text = SessionGoal.continuation(g, { reason: "the tests were not run" })
    expect(text).toContain("Goal: finish the feature")
    expect(text).toContain("the tests were not run")
    expect(text).toContain("Take the next concrete step")
  })

  test("a failed gate becomes the continuation, with the tail of its output", () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")
    const text = SessionGoal.continuation(g, { gate: { command: "bun test", ok: false, output } })
    expect(text).toContain("`bun test` did not pass")
    expect(text).toContain("line 49")
    expect(text).not.toContain("line 10\n")
  })
})

describe("the decision at the end of a turn", () => {
  const g = SessionGoal.parse("x", { now, maxTurns: 3 })

  test("a failing gate is more work, and no judge is consulted", () => {
    const d = SessionGoal.decide({ goal: g, gates: [{ command: "bun test", ok: false, output: "1 fail" }] })
    expect(d.action).toBe("continue")
    expect(d.gate?.command).toBe("bun test")
  })

  test("the four verdicts", () => {
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "done", reason: "all there" } }).action).toBe("done")
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "continue", reason: "more" } }).action).toBe("continue")
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "blocked", reason: "no creds" } })).toEqual({
      action: "pause",
      reason: "no creds",
    })
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "wait", reason: "job running" } }).action).toBe("wait")
  })

  test("background work in flight waits instead of burning a turn — unless the verdict is final", () => {
    expect(SessionGoal.decide({ goal: g, waiting: true, verdict: { verdict: "continue", reason: "" } }).action).toBe(
      "wait",
    )
    expect(SessionGoal.decide({ goal: g, waiting: true, verdict: { verdict: "done", reason: "" } }).action).toBe("done")
  })

  test("the budget: the last turn's CONTINUE becomes a stop, with a reason that says so", () => {
    const spent = { ...g, turns: { used: 3, max: 3 } }
    const d = SessionGoal.decide({ goal: spent, verdict: { verdict: "continue", reason: "more" } })
    expect(d.action).toBe("stop")
    expect(d.reason).toContain("not completion")
    expect(SessionGoal.decide({ goal: spent, gates: [{ command: "c", ok: false, output: "" }] }).action).toBe("stop")
  })

  test("an unreadable verdict continues, and three in a row pause", () => {
    expect(SessionGoal.decide({ goal: g }).action).toBe("continue")
    expect(SessionGoal.decide({ goal: { ...g, judgeFailures: 2 } }).action).toBe("pause")
  })

  test("apply folds the decision into the record", () => {
    const cont = SessionGoal.apply(g, { action: "continue", reason: "r" }, { verdict: "continue", reason: "r" }, now)
    expect(cont.turns.used).toBe(1)
    expect(cont.last?.verdict).toBe("continue")
    expect(cont.judgeFailures).toBe(0)
    const unread = SessionGoal.apply(g, { action: "continue", reason: "" }, undefined, now)
    expect(unread.judgeFailures).toBe(1)
    const done = SessionGoal.apply(g, { action: "done", reason: "yes" }, { verdict: "done", reason: "yes" }, now)
    expect(done.status).toBe("done")
    const blocked = SessionGoal.apply(g, { action: "pause", reason: "b" }, { verdict: "blocked", reason: "b" }, now)
    expect(blocked.status).toBe("blocked")
    const claimed = SessionGoal.apply(
      { ...g, claimed: { evidence: "e", at: now } },
      { action: "continue", reason: "" },
      undefined,
      now,
    )
    expect(claimed.claimed).toBeUndefined()
  })
})

describe("reading the judge", () => {
  test("clean, fenced, prefixed, thinking-wrapped", () => {
    expect(SessionGoal.parseVerdict('{"verdict":"done","reason":"all tests pass"}')).toEqual({
      verdict: "done",
      reason: "all tests pass",
    })
    expect(SessionGoal.parseVerdict('Sure.\n```json\n{"verdict": "CONTINUE", "reason": "no tests run"}\n```')).toEqual({
      verdict: "continue",
      reason: "no tests run",
    })
    expect(SessionGoal.parseVerdict('<think>hmm</think>{"verdict":"wait","reason":""}')?.verdict).toBe("wait")
  })

  test("garbage is undefined, never a verdict", () => {
    expect(SessionGoal.parseVerdict("I think it's done")).toBeUndefined()
    expect(SessionGoal.parseVerdict('{"verdict":"maybe"}')).toBeUndefined()
    expect(SessionGoal.parseVerdict('{"verdict": ')).toBeUndefined()
  })
})

describe("one line for a status bar", () => {
  test("says the state and the turn", () => {
    const g = SessionGoal.parse("x", { now })
    expect(SessionGoal.describe(g)).toBe("goal · turn 1/20")
    expect(SessionGoal.describe(SessionGoal.paused(g, "interrupted", now))).toBe("goal · paused — interrupted")
    expect(SessionGoal.describe({ ...g, status: "done" })).toBe("goal · done")
  })
})
