import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EvalHistory, type Row } from "../lib/history"

let clock = 1_000
function row(overrides: Partial<Row>): Row {
  return {
    runId: "r",
    time: clock++,
    eval: "edit",
    model: "a/model",
    mode: "live",
    hermetic: false,
    outcome: "completed",
    passed: true,
    assertions: [],
    tokens: 100,
    cost: 0.01,
    durationMs: 1000,
    steps: 3,
    toolCalls: 2,
    guards: {},
    ...overrides,
  }
}

describe("history", () => {
  test("rows are appended as jsonl and a torn line does not hide the rest", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eval-history-")), "nested", "history.jsonl")
    EvalHistory.append(file, row({ runId: "one" }))
    fs.appendFileSync(file, '{"runId":"torn"\n')
    EvalHistory.append(file, row({ runId: "two" }))
    expect(EvalHistory.read(file).map((item) => item.runId)).toEqual(["one", "two"])
    expect(EvalHistory.read(path.join(file, "missing"))).toEqual([])
  })

  test("a row passes only when the run completed and every assertion passed", () => {
    const record = {
      eval: "e", model: "m", mode: "scripted", hermetic: true, outcome: "completed", text: "", texts: [], tools: [],
      usage: { input: 1, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: 0 }, cost: 0.5, durationMs: 9, steps: 1,
      guards: [{ guard: "loop", action: "correct", detail: "x" }, { guard: "loop", action: "correct", detail: "y" }],
      interactions: [], agents: [], requests: [], monitors: [],
    } as const
    const ok = EvalHistory.row({ runId: "r", record, assertions: [{ name: "a", pass: true, message: "" }] })
    expect(ok).toMatchObject({ passed: true, tokens: 6, guards: { "loop:correct": 2 } })
    expect(EvalHistory.row({ runId: "r", record, assertions: [{ name: "a", pass: false, message: "" }] }).passed).toBe(false)
    expect(EvalHistory.row({ runId: "r", record: { ...record, outcome: "crashed" }, assertions: [] }).passed).toBe(false)
  })

  test("baselines: last, best (cheapest passing), another model; never the current run or another mode", () => {
    const rows = [
      row({ runId: "old-pass-cheap", cost: 0.002 }),
      row({ runId: "old-pass-dear", cost: 0.02 }),
      row({ runId: "old-fail", passed: false, outcome: "failed", cost: 0.001 }),
      row({ runId: "scripted", mode: "scripted", cost: 0 }),
      row({ runId: "other-model", model: "b/model", cost: 0.5 }),
      row({ runId: "now", cost: 0.01 }),
    ]
    const current = rows.at(-1)!
    expect(EvalHistory.baselineFor(rows, current, { type: "last" })?.runId).toBe("old-fail")
    expect(EvalHistory.baselineFor(rows, current, { type: "best" })?.runId).toBe("old-pass-cheap")
    expect(EvalHistory.baselineFor(rows, current, { type: "model", model: "b/model" })?.runId).toBe("other-model")
    expect(EvalHistory.baselineFor([current], current, { type: "last" })).toBeUndefined()
  })

  test("comparison flags regressions and fixes and reports deltas only when both costs are measured", () => {
    const passed = row({ runId: "base", cost: 0.01, durationMs: 1000 })
    const failing = row({ runId: "now", passed: false, outcome: "failed", cost: 0.03, durationMs: 1500 })
    expect(EvalHistory.compare(failing, passed)).toMatchObject({ regression: true, fixed: false, durationDelta: 500 })
    expect(EvalHistory.compare(failing, passed).costDelta).toBeCloseTo(0.02)
    expect(EvalHistory.compare(passed, failing)).toMatchObject({ regression: false, fixed: true })
    expect(EvalHistory.compare(row({ cost: null }), passed).costDelta).toBeUndefined()
    expect(EvalHistory.compare(passed, undefined)).toMatchObject({ regression: false, durationDelta: undefined })
  })

  test("parseBaseline accepts last, best and model:<slug> only", () => {
    expect(EvalHistory.parseBaseline(undefined)).toBeUndefined()
    expect(EvalHistory.parseBaseline("best")).toEqual({ type: "best" })
    expect(EvalHistory.parseBaseline("model:openrouter/qwen/qwen3")).toEqual({ type: "model", model: "openrouter/qwen/qwen3" })
    expect(() => EvalHistory.parseBaseline("yesterday")).toThrow("--baseline")
  })

  test("the summary is per model; unmeasured runs are counted but never priced as $0", () => {
    const summaries = EvalHistory.summarize([
      row({ model: "a", cost: 0.01, durationMs: 1000 }),
      row({ model: "a", passed: false, outcome: "crashed", cost: 0.03, durationMs: 3000 }),
      row({ model: "b", passed: false, outcome: "unmeasured", cost: null, tokens: 0 }),
    ])
    expect(summaries).toEqual([
      { model: "a", evals: 2, passed: 1, passRate: 0.5, crashed: 1, unmeasured: 0, cost: 0.04, tokens: 200, avgDurationMs: 2000 },
      { model: "b", evals: 1, passed: 0, passRate: 0, crashed: 0, unmeasured: 1, cost: null, tokens: 0, avgDurationMs: 1000 },
    ])
    const table = EvalHistory.formatSummary(summaries)
    expect(table.split("\n")[0]).toMatch(/^model\s+pass\s+rate\s+crashed\s+unmeasured\s+cost\s+tokens\s+avg time$/)
    expect(table).toContain("unmeasured")
    expect(table).toContain("$0.04")
  })
})
