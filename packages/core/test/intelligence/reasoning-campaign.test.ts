import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Pair, Pairs, plan, switches } from "../../script/reasoning-eval/campaign"

const pair = { id: "small", model: "fixture/coder", responseModel: "coder-v1", evaluator: "fixture/jev" }

test("plans every model pair, experiment and fixed split without including observation in comparisons", () => {
  const result = plan({
    suite: "coding",
    rounds: "3",
    modes: "single,dual,observe",
    experiments: "baseline,verification",
    pairs: [pair, { ...pair, id: "large", model: "fixture/large" }],
  })
  expect(result.selected).toHaveLength(12)
  expect(result.plans).toHaveLength(8)
  expect(result.plans.every((group) => group.expectedRuns === 36)).toBe(true)
  expect(result.expectedExecutions).toBe(432)
  expect(result.expectedComparisons).toBe(288)
  expect(result.timeoutMs).toBe(300_000)
})

test("keeps calibration selection from admitting a reserved case or changing its family", () => {
  const calibration = plan({ suite: "coding", split: "calibration", pairs: [pair] })
  const heldOut = plan({ suite: "coding", split: "held-out", pairs: [pair] })
  expect(calibration.selected).toHaveLength(6)
  expect(heldOut.selected).toHaveLength(6)
  expect(calibration.plans.map((group) => group.split)).toEqual(["calibration"])
  expect(heldOut.plans.map((group) => group.split)).toEqual(["held-out"])
  expect(() => plan({ suite: "coding", split: "calibration", cases: heldOut.selected[0]!.id, pairs: [pair] })).toThrow()
})

test("legacy diagnostic selection keeps eight cases and rejects ambiguous or unsupported configuration", () => {
  expect(plan({ pairs: [pair] }).selected).toHaveLength(8)
  expect(plan({ pairs: [pair] }).timeoutMs).toBe(90_000)
  for (const input of [
    { suite: "unknown" },
    { split: "held-out" },
    { experiments: "baseline,baseline" },
    { experiments: "learning" },
    { experiments: "tools" },
    { experiments: "curation" },
    { modes: "single,single" },
    { rounds: "0" },
    { timeoutMs: "600001" },
    { cases: "missing" },
    { gate: true, modes: "observe" },
  ])
    expect(() => plan({ ...input, pairs: [pair] })).toThrow()
  expect(() => plan({ pairs: [pair, pair] })).toThrow()
  expect(() => plan({ pairs: [{ ...pair, model: "auto/default" }] })).toThrow()
  expect(() => plan({ pairs: [{ ...pair, evaluator: pair.model }] })).toThrow()
})

test("decodes pinned model manifests and activates one experiment at a time", () => {
  expect(Schema.decodeUnknownSync(Pairs)({ pairs: [pair] }).pairs).toEqual([pair])
  expect(() => Schema.decodeUnknownSync(Pair)({ ...pair, id: "../escape" })).toThrow()
  for (const name of ["baseline", "verification"] as const) {
    const enabled = Object.entries(switches(name))
      .filter(([, value]) => value)
      .map(([key]) => key)
    expect(enabled).toEqual(name === "baseline" ? [] : ["reasoning_verification"])
    expect(switches(name).reasoning_learning).toBe(false)
    expect(switches(name).reasoning_context_curation).toBe(false)
  }
})

test("the real CLI can preview a coding campaign without credentials, service startup or inference", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "script/reasoning-eval/run.ts",
      "--suite",
      "coding",
      "--split",
      "held-out",
      "--model",
      pair.model,
      "--response-model",
      pair.responseModel,
      "--evaluator",
      pair.evaluator,
      "--binary",
      "missing-binary",
      "--router",
      "http://127.0.0.1:1/v1",
      "--dry-run",
    ],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
  const preview = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        suite: Schema.String,
        split: Schema.String,
        expectedRuns: Schema.Number,
        cases: Schema.Array(Schema.Struct({ id: Schema.String })),
      }),
    ),
  )(stdout)
  expect(preview).toMatchObject({ suite: "coding", split: "held-out", expectedRuns: 24 })
  expect(preview.cases).toHaveLength(6)
  expect(stdout).not.toContain("oracle")
  expect(stdout).not.toContain("reference")
})
