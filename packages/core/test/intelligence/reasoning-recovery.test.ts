import { expect, test } from "bun:test"
import path from "node:path"
import {
  ARMS,
  POLICY,
  grade,
  guidance,
  plan,
  prompt,
  questions,
  report,
  requirements,
  type Run,
} from "../../script/reasoning-eval/recovery"
import { prepare, snapshot, verify } from "../../script/reasoning-eval/coding"
import { proxy, type RequestMetric } from "../../script/reasoning-eval/transport"
import { tmpdir } from "../fixture/tmpdir"

test("recovery freezes candidate identities and separates reserved families without credentials", () => {
  const calibration = plan({})
  const reserved = plan({ split: "held-out" })
  expect(calibration.expectedRuns).toBe(18)
  expect(calibration.selected.filter((item) => item.expectedDefect)).toHaveLength(3)
  expect(calibration.selected.filter((item) => !item.expectedDefect)).toHaveLength(3)
  expect(reserved.selected.some((item) => calibration.selected.some((other) => other.family === item.family))).toBe(
    false,
  )
  expect(plan({}).signature).toBe(calibration.signature)
  expect(reserved.signature).not.toBe(calibration.signature)
  expect(plan({ rounds: "2" }).expectedRuns).toBe(36)
  for (const input of [{ rounds: "0" }, { rounds: "NaN" }, { rounds: "11" }, { split: "all" }, { corpus: "unknown" }])
    expect(() => plan(input)).toThrow()
})

test("guidance derives typed requirements only from the public contract", () => {
  for (const item of plan({}).selected) {
    const contract = item.fixture.prompt.split("\n\n")[0]!
    const selected = requirements(item.fixture.prompt)
    expect(selected.length).toBeGreaterThan(1)
    expect(selected.every((requirement) => contract.includes(requirement.text))).toBe(true)
    const specific = questions("s1-requirements", item.fixture.prompt)
    expect(Object.keys(specific)).toEqual(selected.map((requirement) => requirement.id))
    expect(Object.values(specific).every((question) => question.type === "noul")).toBe(true)
    expect(Object.keys(questions("s1-generic", item.fixture.prompt))).toEqual(["code_behavior", "code_contract"])
    const text = guidance("s1-requirements", item.fixture.prompt, [selected[1]!.id])
    expect(text).toContain(selected[1]!.text)
    expect(text).not.toContain(selected[0]!.text)
    expect(text).not.toContain(item.fixture.oracle)
    expect(text).not.toContain("expectedDefect")
    expect(text).not.toContain(item.id)
    expect(guidance("s2-review", item.fixture.prompt, [])).toContain("No defect has been established")
    expect(prompt({ request: item.fixture.prompt, guidance: text, editable: item.fixture.editable })).toContain(
      "preserve it unchanged",
    )
  }
})

test("independent recovery grading accepts unchanged correct controls and demands a verified repair", async () => {
  await using temporary = await tmpdir("redcode-recovery-grading-")
  const pair = plan({}).selected.filter((item) => item.family === "composite-page-cursor")
  const defective = pair.find((item) => item.expectedDefect)!
  const correct = pair.find((item) => !item.expectedDefect)!
  const directory = path.join(temporary.path, "candidate")
  await prepare(defective.fixture, directory)
  const before = await snapshot(directory)
  const initial = await verify(defective.fixture, directory, path.join(temporary.path, "initial"))
  expect(initial.pass).toBe(false)
  const unchanged = grade({
    expectedDefect: true,
    editable: defective.fixture.editable,
    before,
    after: before,
    oracle: initial,
    freshTest: false,
  })
  expect(unchanged.pass).toBe(false)
  expect(unchanged.failed).toContain("no_repair")
  await prepare(correct.fixture, directory)
  const after = await snapshot(directory)
  const final = await verify(correct.fixture, directory, path.join(temporary.path, "final"))
  expect(final.pass).toBe(true)
  const input = { expectedDefect: true, editable: defective.fixture.editable, before, after, oracle: final }
  expect(grade({ ...input, freshTest: true }).pass).toBe(true)
  expect(grade({ ...input, freshTest: false }).failed).toEqual(["no_fresh_test"])
  expect(grade({ ...input, expectedDefect: false, before: after, freshTest: false })).toMatchObject({
    pass: true,
    changes: [],
  })
  expect(grade({ ...input, freshTest: true, after: { ...after, "src.test.ts": "changed-test" } }).failed).toContain(
    "out_of_scope:src.test.ts",
  )
  expect(grade({ ...input, freshTest: true, after: { ...after, "new.ts": "added" } }).pass).toBe(false)
  expect(
    grade({ ...input, freshTest: true, oracle: { ...final, pass: false, failed: ["oracle_incomplete"] } }).pass,
  ).toBe(false)
})

function rows(): Run[] {
  return ARMS.flatMap((arm) =>
    [true, false].map((expectedDefect) => ({
      candidateID: expectedDefect ? "broken" : "correct",
      round: 1,
      arm,
      expectedDefect,
      valid: true,
      passed: arm !== "s2-review" || !expectedDefect,
      changed: expectedDefect && arm !== "s2-review",
      admitted: arm === "s2-review" || expectedDefect,
      durationMs: 100,
      s1CostUsd: arm === "s2-review" ? 0 : 0.01,
      s2CostUsd: 0.1,
    })),
  )
}

test("recovery gates require paired improvement, preservation, full billing and per-case cost", () => {
  const result = report(rows(), 6)
  expect(result.complete).toBe(true)
  expect(result.acceptance.every((arm) => arm.passed)).toBe(true)
  expect(result.summaries[0]).toMatchObject({ recovered: 0, missed: 1, preserved: 1, falseAlarms: null })
  expect(result.summaries[1]).toMatchObject({ recovered: 1, missed: 0, preserved: 1, falseAlarms: 0 })
  const changed = (input: Partial<Run>) =>
    rows().map((row) => (row.arm === "s1-requirements" && row.expectedDefect ? { ...row, ...input } : row))
  expect(report(changed({ passed: false, admitted: false }), 6).acceptance[1]?.reasons).toContain(
    "no_recovery_improvement",
  )
  expect(report(changed({ s1CostUsd: undefined }), 6).acceptance[1]?.reasons).toContain("unknown_total_cost")
  expect(report(changed({ s2CostUsd: 0.25 }), 6).acceptance[1]?.reasons).toContain("cost_above_2x")
  expect(report(changed({ valid: false }), 6).acceptance[1]?.reasons).toContain("invalid_execution")
  expect(report(rows().slice(1), 6).acceptance.every((arm) => !arm.passed)).toBe(true)
  const duplicate = rows()
  duplicate[1] = duplicate[0]!
  expect(report(duplicate, 6).complete).toBe(false)
  const degraded = rows().map((row) =>
    row.arm === "s1-requirements" && !row.expectedDefect ? { ...row, passed: false, changed: true } : row,
  )
  expect(report(degraded, 6).acceptance[1]?.reasons).toContain("correct_candidate_degraded")
  expect(report(degraded, 6).acceptance[1]?.reasons).toContain("paired_regression")
})

test("a confident but unnecessary repair remains a false alarm even when the code still passes", () => {
  const sample = rows().map((row) =>
    row.arm === "s1-generic" && !row.expectedDefect ? { ...row, admitted: true, changed: true } : row,
  )
  expect(report(sample, 6).summaries[1]).toMatchObject({ preserved: 1, falseAlarms: 1, unnecessaryChanges: 1 })
  const unknown = rows().map((row) => ({ ...row, s1CostUsd: undefined }))
  expect(report(unknown, 6).summaries.every((arm) => !arm.costComplete)).toBe(true)
  const free = rows().map((row) => ({ ...row, s1CostUsd: 0, s2CostUsd: 0 }))
  expect(report(free, 6).acceptance.every((arm) => arm.costRatio === 1)).toBe(true)
})

test("HTTP receipts retain output limits and final tool choice without leaking model prompts", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ model: "coder", usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0 } }),
  })
  const metrics: RequestMetric[] = []
  const recorder = proxy(server.url.href, { run: "recovery" }, metrics)
  try {
    for (const tokenKey of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
      await (
        await fetch(new URL("v1/chat/completions", recorder.url), {
          method: "POST",
          headers: { Authorization: "Bearer private-key" },
          body: JSON.stringify({
            model: "coder",
            [tokenKey]: POLICY.maxTokens,
            tool_choice: "none",
            messages: [{ content: "private-prompt" }],
          }),
        })
      ).text()
    }
    expect(metrics).toHaveLength(3)
    expect(
      metrics.every(
        (metric) =>
          metric.maxOutputTokens === POLICY.maxTokens &&
          metric.toolChoice === "none" &&
          metric.complete &&
          metric.status === 200,
      ),
    ).toBe(true)
    expect(metrics.every((metric) => metric.bytes > 0 && metric.durationMs !== null)).toBe(true)
    expect(JSON.stringify(metrics)).not.toContain("private-prompt")
    expect(JSON.stringify(metrics)).not.toContain("private-key")
  } finally {
    recorder.stop(true)
    server.stop(true)
  }
})

test("recovery dry-run enumerates eighteen fixed-candidate executions without models or credentials", async () => {
  const child = Bun.spawn([process.execPath, "script/reasoning-eval/recovery-run.ts", "--dry-run"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
  expect(stdout).toContain('"expectedRuns": 18')
  expect(stdout).toContain('"artifact": "bounded-complete-source"')
  expect(stdout).not.toContain("oracle")
  expect(stdout).not.toContain("key-file")
})
