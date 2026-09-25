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
    expect(
      SessionGoal.decide({ goal: g, evidence: true, verdict: { verdict: "done", reason: "all there" } }).action,
    ).toBe("done")
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "continue", reason: "more" } }).action).toBe("continue")
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "blocked", reason: "no creds" } })).toEqual({
      action: "pause",
      reason: "no creds",
    })
    expect(SessionGoal.decide({ goal: g, verdict: { verdict: "wait", reason: "job running" } }).action).toBe("wait")
  })

  test("background work in flight prevents completion", () => {
    expect(SessionGoal.decide({ goal: g, waiting: true, verdict: { verdict: "continue", reason: "" } }).action).toBe(
      "wait",
    )
    expect(SessionGoal.decide({ goal: g, waiting: true, verdict: { verdict: "done", reason: "" } }).action).toBe("wait")
  })

  test("the budget: the last turn's CONTINUE becomes a stop, with a reason that says so", () => {
    // `used` counts judged turns, so with two of three spent this is the third and last.
    const spent = { ...g, turns: { used: 2, max: 3 } }
    const d = SessionGoal.decide({ goal: spent, verdict: { verdict: "continue", reason: "more" } })
    expect(d.action).toBe("stop")
    expect(d.reason).toContain("running out of turns is not completion")
    expect(SessionGoal.decide({ goal: spent, gates: [{ command: "c", ok: false, output: "" }] }).action).toBe("stop")
    expect(SessionGoal.decide({ goal: spent, evidence: false, verdict: { verdict: "done", reason: "" } }).action).toBe(
      "stop",
    )
    // One turn earlier there is still a turn left to spend.
    const left = { ...g, turns: { used: 1, max: 3 } }
    expect(SessionGoal.decide({ goal: left, verdict: { verdict: "continue", reason: "more" } }).action).toBe("continue")
  })

  test("an unreadable verdict continues, and three in a row pause", () => {
    expect(SessionGoal.decide({ goal: g }).action).toBe("continue")
    expect(SessionGoal.decide({ goal: { ...g, judgeFailures: 2 } }).action).toBe("pause")
  })

  test("apply folds the decision into the record; every judged turn spends one, a WAIT spends none", () => {
    const cont = SessionGoal.apply(g, { action: "continue", reason: "r" }, { verdict: "continue", reason: "r" }, now)
    expect(cont.turns.used).toBe(1)
    expect(cont.judged).toBe(now)
    expect(cont.last?.verdict).toBe("continue")
    expect(cont.judgeFailures).toBe(0)
    const waited = SessionGoal.apply(g, { action: "wait", reason: "w" }, { verdict: "wait", reason: "w" }, now)
    expect(waited.turns.used).toBe(0)
    expect(waited.judged).toBeUndefined()
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

describe("the evidence the judge reads", () => {
  test("gate results survive the cut; the tool output before them is what gets trimmed", () => {
    const observed = Array.from({ length: 40 }, (_, i) => `read: ${"x".repeat(1000)} file-${i}`)
    const text = SessionGoal.evidence([{ command: "bun test", ok: true, output: "12 pass" }], observed)
    expect(text.length).toBeLessThanOrEqual(SessionGoal.EVIDENCE_CHARS)
    expect(text).toContain("bun test: PASS\n12 pass")
    expect(text).toContain("file-39")
    expect(text).not.toContain("file-0\n")
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
  test("resuming an exhausted budget stays paused until its limit increases", () => {
    const goal = SessionGoal.parse("x", { maxTurns: 1, now })
    const exhausted = { ...goal, turns: { used: 1, max: 1 } }
    const paused = SessionGoal.resumed(exhausted, now + 1)
    expect(paused.status).toBe("paused")
    expect(paused.reason).toContain("/goal budget")
    expect(paused.reason).toContain("/goal resume")
    const resumed = SessionGoal.resumed({ ...paused, turns: { used: 1, max: 2 } }, now + 2)
    expect(resumed.status).toBe("active")
    expect(resumed.turns.used).toBe(1)
    expect(resumed.reason).toBeUndefined()
  })

  test("says the state and the turn", () => {
    const g = SessionGoal.parse("x", { now })
    expect(SessionGoal.describe(g)).toBe("goal · turn 1/20")
    expect(SessionGoal.describe(SessionGoal.paused(g, "interrupted", now))).toBe("goal · paused — interrupted")
    expect(SessionGoal.describe({ ...g, status: "done" })).toBe("goal · done")
  })
})

describe("a goal, inherited by a subagent", () => {
  test("carries the objective and the contract, not the budget or the completion tool", () => {
    const g = SessionGoal.parse("ship the cache fix; verify: bun test; constraints: no new deps", { maxTurns: 7 })
    const block = SessionGoal.inherit(g)
    expect(block.startsWith("<goal>")).toBe(true)
    expect(block).toContain("Objective: ship the cache fix")
    expect(block).toContain("Verification: bun test")
    expect(block).toContain("Constraints: no new deps")
    expect(block).toContain("one part of a larger goal")
    expect(block).not.toContain("Turn 1 of 7")
    expect(block).not.toContain("goal_complete")
  })
})

test("Design-only scope survives TUI goal persistence", () => {
  const goal = SessionGoal.parse("Review the prototype; constraints: leave product code unchanged", {
    stopAfter: "design",
  })
  expect(SessionGoal.fromMetadata({ goal })?.stopAfter).toBe("design")
  expect(SessionGoal.render(goal)).toContain("Scope ends in design")
})

test("resuming a goal the loop guard paused answers the guard, not a judge", () => {
  const goal = SessionGoal.parse("Ship the retry fix")
  const text = SessionGoal.continuation(goal, { reason: "loop guard: task updates kept failing (8 in a row)" })
  expect(text).toContain("Goal: Ship the retry fix")
  expect(text).toContain("The last turn was stopped by the loop guard: task updates kept failing (8 in a row).")
  expect(text).toContain("cite a successful verification result with an explanation, or block the task")
  expect(text).not.toContain("judge")
  expect(text).not.toContain("Paused:")
  // A judge's pause keeps the judge's wording.
  expect(SessionGoal.continuation(goal, { reason: "the tests were not run" })).toContain(
    "The judge's reason for not accepting the last turn: the tests were not run",
  )
})

test("resuming a goal the compaction guard paused answers the context pressure, not a judge", () => {
  const goal = SessionGoal.parse("Sweep the repository")
  const text = SessionGoal.continuation(goal, {
    reason: "compaction guard: 2 compactions in a row left the context above 80% of the usable context",
  })
  expect(text).toContain("The last turn stopped at a context compaction: 2 compactions in a row")
  expect(text).toContain("Keep the context small")
  expect(text).not.toContain("The judge's reason")
})

describe("a goal's spend budget", () => {
  const total = (cost: number, tokens = 0) => ({ cost, tokens, unpriced: 0 })

  test("there is none unless the person sets one, and the model never sees one", () => {
    const goal = SessionGoal.parse("Ship the retry fix; verify: bun test", { now })
    expect(goal.budget).toBeUndefined()
    expect(SessionGoal.spendStatus(goal, total(10_000, 10_000_000))).toBeUndefined()
    expect(SessionGoal.render(goal)).not.toMatch(/budget|\$/i)
    expect(SessionGoal.inherit(goal)).not.toMatch(/budget|\$/i)
    // Without a budget, no amount of spend changes a decision or blocks a resume.
    expect(SessionGoal.decide({ goal, verdict: { verdict: "continue", reason: "more" } }).action).toBe("continue")
    expect(SessionGoal.resumed(SessionGoal.paused(goal, "interrupted", now), now + 1, total(10_000)).status).toBe("active")
  })

  test("max cost and max tokens are the person's fields; they never reach the contract", () => {
    const goal = SessionGoal.parse("Ship it; max cost: $2; max tokens: 500k; constraints: no new deps", { now })
    expect(goal.budget).toEqual({ max_cost_usd: 2, max_tokens: 500_000 })
    expect(goal.objective).toBe("Ship it")
    expect(goal.contract).toEqual({ constraints: "no new deps" })
    expect(SessionGoal.render(goal)).not.toContain("$2")
    expect(SessionGoal.fromMetadata({ goal })?.budget).toEqual({ max_cost_usd: 2, max_tokens: 500_000 })
  })

  test("a reached budget turns more work into a pause, and a DONE still stands", () => {
    const goal = { ...SessionGoal.parse("x", { now, budget: { max_cost_usd: 2 } }), spendStart: total(1) }
    const budget = SessionGoal.spendStatus(goal, total(3))!
    expect(budget.exceeded).toBe(true)
    const stop = SessionGoal.decide({ goal, verdict: { verdict: "continue", reason: "more" }, budget })
    expect(stop).toEqual({ action: "stop", reason: "budget: $2.00 of $2.00 spent" })
    expect(SessionGoal.apply(goal, stop, { verdict: "continue", reason: "more" }, now).status).toBe("paused")
    expect(
      SessionGoal.decide({ goal, verdict: { verdict: "done", reason: "ok" }, evidence: true, budget }).action,
    ).toBe("done")
  })

  test("a spend line that does not parse stays in the objective and is reported, never dropped", () => {
    const { goal, warnings } = SessionGoal.parseWithWarnings("Ship it; max cost: $2,5,0", { now })
    expect(goal.budget).toBeUndefined()
    expect(goal.objective).toBe("Ship it max cost: $2,5,0")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"max cost: $2,5,0" was not set as a spend limit')
    expect(SessionGoal.parseWithWarnings("Ship it; max cost: $2", { now }).warnings).toEqual([])
  })

  test("spend lines alone are not a goal: the objective is empty and callers refuse it", () => {
    expect(SessionGoal.parse("max cost: $2; max tokens: 500k", { now }).objective).toBe("")
    expect(SessionGoal.parse("max cost: nonsense", { now }).objective).toBe("")
    expect(SessionGoal.NEEDS_OBJECTIVE).toContain("goal needs an objective")
    // A goal without spend lines keeps its old fallback.
    expect(SessionGoal.parse("verify: bun test", { now }).objective).toBe("verify: bun test")
  })

  test("decimal commas set the limit they say", () => {
    expect(SessionGoal.parse("Ship; max cost: $2,50; max tokens: 1,5m", { now }).budget).toEqual({
      max_cost_usd: 2.5,
      max_tokens: 1_500_000,
    })
  })

  test("resuming stays paused while the session budget is reached, instead of starting and pausing again", () => {
    const goal = SessionGoal.paused(SessionGoal.parse("x", { now }), "budget: $1.00 of $0.50 spent", now)
    const still = SessionGoal.resumed(goal, now + 1, total(1), { exceeded: true, reason: "$1.00 of $0.50 spent" })
    expect(still).toMatchObject({ status: "paused", reason: "budget: $1.00 of $0.50 spent" })
    expect(SessionGoal.resumed(goal, now + 2, total(1), { exceeded: false, reason: "" }).status).toBe("active")
  })

  test("resuming stays paused until the budget is raised, then asks before overspending", () => {
    const goal = { ...SessionGoal.parse("x", { now, budget: { max_cost_usd: 2 } }), spendStart: total(0) }
    const paused = SessionGoal.resumed(SessionGoal.paused(goal, "budget: $2.00 of $2.00 spent", now), now + 1, total(2))
    expect(paused.status).toBe("paused")
    expect(paused.reason).toBe("budget: $2.00 of $2.00 spent")
    const raised = SessionGoal.resumed({ ...paused, budget: { max_cost_usd: 5 } }, now + 2, total(2))
    expect(raised.status).toBe("active")
    const text = SessionGoal.continuation(raised, { reason: "budget: $2.00 of $2.00 spent" })
    expect(text).toContain("reached the spend budget the user set: $2.00 of $2.00 spent")
    expect(text).toContain("ask the user whether to raise the budget")
    expect(text).not.toContain("The judge's reason")
  })
})
