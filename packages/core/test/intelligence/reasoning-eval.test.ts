import { expect, test } from "bun:test"
import { acceptance, campaign, markdown, pairs, score, summarize, type Run } from "../../script/reasoning-eval/report"
import { evaluationsSettled } from "../../script/reasoning-eval/trace"
import { evaluation } from "./fixtures"
import {
  observedCost,
  observedModels,
  observedUsage,
  proxy,
  type RequestMetric,
} from "../../script/reasoning-eval/transport"

const passed = score('{"ok":true}', { ok: true })
const failed = score('{"ok":false}', { ok: true })

function run(input: Partial<Run> = {}): Run {
  return {
    caseID: "control",
    round: 1,
    mode: "single",
    outcome: "succeeded",
    durationMs: 100,
    initial: passed,
    final: passed,
    repairs: 0,
    s1Tokens: 0,
    s2Tokens: 100,
    s2CostUsd: 0,
    s2Unpriced: true,
    evaluatorFailures: 0,
    ...input,
  }
}

function improvement(input: Partial<Run> = {}) {
  return [
    run({ ...input, initial: failed, final: failed, s2CostUsd: 1, s2Unpriced: false, mode: "single" }),
    run({ ...input, s2CostUsd: 1, s1CostUsd: 0.25, s2Unpriced: false, mode: "dual" }),
  ]
}

test("grades exact facts independently of key order, retaining format and extra-field failures", () => {
  expect(score('{"nested":{"b":2,"a":1},"unknown":null}', { unknown: null, nested: { a: 1, b: 2 } }).pass).toBe(true)
  expect(score("{}", { unknown: null }).failed).toEqual(["unknown"])
  expect(score('{"ok":true,"claim":"verified"}', { ok: true }).score).toBe(0.5)
  expect(score('```json\n{"ok":true}\n```', { ok: true }).format).toBe(false)
  expect(score('{"list":[2,1]}', { list: [1, 2] }).pass).toBe(false)
})

test("corpora cannot be mixed to manufacture matched accuracy or campaign acceptance", () => {
  const runs = improvement({ corpus: "challenge" })
  const group = {
    corpus: "challenge",
    pairID: "legacy",
    experiment: "legacy",
    split: "calibration" as const,
    expectedRuns: 2,
  }
  expect(acceptance(runs, 2).passed).toBe(true)
  const mixed = [runs[0]!, { ...runs[1]!, corpus: "original" }]
  expect(pairs(mixed)).toHaveLength(0)
  expect(acceptance(mixed, 2).reasons).toContain("incomplete_or_invalid_suite")
  const identified = runs.map((run) => ({
    ...run,
    pairID: group.pairID,
    experiment: group.experiment,
    split: group.split,
  }))
  expect(campaign(identified, [group], 2).passed).toBe(true)
  expect(campaign(identified, [{ ...group, corpus: "original" }], 2).passed).toBe(false)
  expect(markdown(runs, "coder", "jev", 2, { corpus: "challenge" })).toContain("Coding corpus: `challenge`")
})

test("failures remain in the denominator and unknown prices remain incomplete", () => {
  const summary = summarize([run(), run({ outcome: "timeout" }), run({ outcome: "invalid" })])[0]
  expect(summary.passRate).toBe(1 / 3)
  expect(summary.meanScore).toBe(1 / 3)
  expect(summary.costComplete).toBe(false)
  expect(summary.s2Tokens).toBe(300)
})

test("completed S2 cannot imply settled asynchronous S1 billing", () => {
  expect(evaluationsSettled("single", [], undefined)).toBe(true)
  expect(evaluationsSettled("dual", [evaluation({ operation: "response_quality" })], 0)).toBe(false)
  expect(evaluationsSettled("dual", [evaluation({ operation: "prompt_classification" })], undefined)).toBe(true)
  expect(
    evaluationsSettled(
      "dual",
      [evaluation({ operation: "prompt_classification", decision: "unavailable" })],
      undefined,
    ),
  ).toBe(true)
  expect(evaluationsSettled("observe", [], 1)).toBe(false)
  expect(evaluationsSettled("observe", [], 0)).toBe(true)
  const runs = improvement({ advisoryWaitMs: 450 })
  expect(summarize(runs)[1]).toMatchObject({ medianDurationMs: 100, medianAdvisoryWaitMs: 450 })
  expect(markdown(runs, "coder", "jev", 2)).toContain("Median post-completion S1 collection ms")
})

test("separates improved, unnecessary, degraded and ineffective repairs", () => {
  const summary = summarize([
    run({ mode: "dual", repairs: 1, initial: failed }),
    run({ mode: "dual", repairs: 1 }),
    run({ mode: "dual", repairs: 1, final: failed }),
    run({ mode: "dual", repairs: 1, initial: failed, final: failed }),
  ])[1]
  expect(summary).toMatchObject({
    repaired: 4,
    improved: 1,
    unnecessary: 1,
    degraded: 1,
    ineffective: 1,
    costComplete: false,
  })
})

test("pairs only matching cases and rounds, including all S1 tokens", () => {
  expect(
    pairs([
      run(),
      run({ mode: "dual", durationMs: 250, s1Tokens: 500, s2Tokens: 150 }),
      run({ round: 2 }),
      run({ mode: "dual", caseID: "other" }),
    ]),
  ).toEqual([
    { caseID: "control", round: 1, singlePassed: true, dualPassed: true, durationDeltaMs: 150, tokenDelta: 550 },
  ])
})

test("extracts upstream models from JSON and SSE, excluding keepalives and malformed frames", () => {
  expect(observedModels('{"model":"pinned"}')).toEqual(["pinned"])
  expect(
    observedModels(
      ': ping\ndata: {"model":"keepalive"}\ndata: {"model":"pinned"}\ndata: invalid\ndata: {"model":"pinned"}\ndata: [DONE]\n',
    ),
  ).toEqual(["pinned"])
})

test("requires strict improvement and complete monetary costs at or below twice single", () => {
  const runs = [
    run({ final: failed, s2CostUsd: 1, s2Unpriced: false }),
    run({ mode: "dual", s2CostUsd: 1.5, s1CostUsd: 0.5, s2Unpriced: false }),
  ]
  expect(acceptance(runs, 2)).toMatchObject({ passed: true, costRatio: 2 })
  expect(acceptance([runs[0]!, { ...runs[1]!, s1CostUsd: 0.501 }], 2).reasons).toContain("cost_above_2x")
  expect(acceptance([runs[0]!, { ...runs[1]!, s1CostUsd: undefined }], 2).reasons).toContain("unknown_total_cost")
  expect(acceptance(runs, 4).reasons).toContain("incomplete_or_invalid_suite")
  expect(acceptance([{ ...runs[0]!, final: passed }, runs[1]!], 2).reasons).toContain("no_accuracy_improvement")
})

test("rejects a case regression even when aggregate accuracy improves", () => {
  const runs = [
    run({ s2CostUsd: 1, s2Unpriced: false }),
    run({ mode: "dual", final: failed, s2CostUsd: 1, s1CostUsd: 0, s2Unpriced: false }),
    ...["a", "b"].flatMap((caseID) => [
      run({ caseID, final: failed, s2CostUsd: 1, s2Unpriced: false }),
      run({ caseID, mode: "dual", s2CostUsd: 1, s1CostUsd: 0, s2Unpriced: false }),
    ]),
  ]
  expect(acceptance(runs, 6)).toMatchObject({ passed: false, regressedCases: ["control"] })
})

test("pairs remain separate across model identities, experiments and calibration splits", () => {
  const singles = [
    run({ pairID: "first", experiment: "baseline", split: "calibration", durationMs: 100 }),
    run({ pairID: "second", experiment: "baseline", split: "calibration", durationMs: 200 }),
    run({ pairID: "first", experiment: "verification", split: "calibration", durationMs: 300 }),
    run({ pairID: "first", experiment: "baseline", split: "held-out", durationMs: 400 }),
  ]
  const duals = singles
    .toReversed()
    .map((single) => ({ ...single, mode: "dual" as const, durationMs: single.durationMs * 2 }))
  expect(
    pairs([...singles, ...duals]).map((pair) => [pair.pairID, pair.experiment, pair.split, pair.durationDeltaMs]),
  ).toEqual([
    ["first", "baseline", "calibration", 100],
    ["second", "baseline", "calibration", 200],
    ["first", "verification", "calibration", 300],
    ["first", "baseline", "held-out", 400],
  ])
  expect(
    pairs([
      singles[0]!,
      ...duals.filter(
        (dual) => dual.pairID !== "first" || dual.experiment !== "baseline" || dual.split !== "calibration",
      ),
    ]),
  ).toEqual([])
})

test("legacy identifiers still match while duplicate physical results invalidate the suite", () => {
  const runs = improvement()
  expect(pairs([runs[0]!, { ...runs[1]!, pairID: "legacy", experiment: "legacy" }])).toHaveLength(1)
  const duplicate = [runs[0]!, runs[0]!, runs[1]!, runs[1]!]
  expect(pairs(duplicate)).toEqual([])
  expect(acceptance(duplicate, 4).reasons).toContain("incomplete_or_invalid_suite")
})

test("one model pair or experiment cannot hide another's case regression", () => {
  for (const field of ["pairID", "experiment"] as const) {
    const runs = [
      run({ [field]: "regression", s2CostUsd: 1, s2Unpriced: false }),
      run({ [field]: "regression", mode: "dual", final: failed, s2CostUsd: 1, s1CostUsd: 0, s2Unpriced: false }),
      ...improvement({ [field]: "improvement", caseID: "control" }),
      ...improvement({ [field]: "improvement", caseID: "another" }),
    ]
    expect(acceptance(runs, runs.length)).toMatchObject({ passed: false, regressedCases: ["control"] })
  }
})

test("the per-comparison monetary ceiling cannot be masked by a cheaper group", () => {
  const expensive = improvement({ pairID: "expensive", experiment: "baseline", split: "held-out" })
  const cheap = improvement({ pairID: "cheap", experiment: "baseline", split: "held-out" })
  const runs = [
    expensive[0]!,
    { ...expensive[1]!, s2CostUsd: 2.5, s1CostUsd: 0.5 },
    { ...cheap[0]!, s2CostUsd: 100 },
    { ...cheap[1]!, s2CostUsd: 100, s1CostUsd: 0 },
  ]
  expect(acceptance(runs, 4)).toMatchObject({
    passed: false,
    overBudgetPairs: [{ pairID: "expensive", experiment: "baseline", split: "held-out", caseID: "control", round: 1 }],
  })
  expect(acceptance(runs, 4).costRatio).toBeLessThan(2)
  expect(acceptance(runs, 4).reasons).toContain("cost_above_2x")
})

test("campaign gates each planned split and keeps failed held-out runs and unknown costs", () => {
  const calibration = { pairID: "first", experiment: "baseline", split: "calibration" as const, expectedRuns: 2 }
  const heldOut = { ...calibration, split: "held-out" as const, expectedRuns: 4 }
  const timeout = improvement({ ...heldOut, caseID: "timed-out" })
  const report = campaign(
    [
      ...improvement(calibration),
      ...improvement(heldOut),
      timeout[0]!,
      { ...timeout[1]!, outcome: "timeout", s1CostUsd: undefined },
      run({ ...heldOut, mode: "observe", s2Unpriced: false, s1CostUsd: 0 }),
    ],
    [calibration, heldOut],
  )
  expect(report.passed).toBe(false)
  expect(report.groups[0]?.acceptance.passed).toBe(true)
  expect(report.groups[1]?.summary[1]).toMatchObject({
    runs: 2,
    passed: 1,
    passRate: 0.5,
    meanScore: 0.5,
    costComplete: false,
  })
  expect(report.groups[1]?.summary[2]?.runs).toBe(1)
  expect(report.groups[1]?.acceptance.reasons).toContain("incomplete_or_invalid_suite")
  expect(report.groups[1]?.acceptance.reasons).toContain("unknown_total_cost")
})

test("campaign rejects missing runs, empty plans, duplicate plans and unplanned groups", () => {
  const plan = { pairID: "first", experiment: "baseline", split: "held-out" as const, expectedRuns: 2 }
  const runs = improvement(plan)
  expect(campaign(runs, [plan]).passed).toBe(true)
  const observation = campaign([...runs, run({ ...plan, mode: "observe", outcome: "timeout" })], [plan])
  expect(observation.passed).toBe(true)
  expect(observation.groups[0]?.summary[2]).toMatchObject({ runs: 1, passed: 0, costComplete: false })
  expect(campaign([], []).passed).toBe(false)
  expect(campaign(runs, []).passed).toBe(false)
  expect(campaign([], [plan]).groups[0]?.acceptance.reasons).toContain("incomplete_or_invalid_suite")
  expect(campaign([runs[0]!], [plan]).passed).toBe(false)
  expect(campaign(runs, [plan, plan]).passed).toBe(false)
  const missing = campaign(runs, [plan, { ...plan, experiment: "verification" }])
  expect(missing.passed).toBe(false)
  expect(missing.groups[1]?.summary[0]?.runs).toBe(0)
  expect(campaign([...runs, ...improvement({ ...plan, pairID: "unplanned" })], [plan]).passed).toBe(false)
})

test("aggregate improvement does not certify an unchanged held-out group", () => {
  const calibration = { pairID: "first", experiment: "baseline", split: "calibration" as const, expectedRuns: 2 }
  const heldOut = { ...calibration, split: "held-out" as const }
  const unchanged = improvement(heldOut)
  const runs = [...improvement(calibration), { ...unchanged[0]!, final: passed }, unchanged[1]!]
  expect(acceptance(runs, 4).passed).toBe(true)
  const report = campaign(runs, [calibration, heldOut])
  expect(report.passed).toBe(false)
  expect(report.groups[1]?.acceptance.reasons).toContain("no_accuracy_improvement")
})

test("explicit campaign completeness includes observation without using its accuracy or price in acceptance", () => {
  const plan = { pairID: "first", experiment: "baseline", split: "held-out" as const, expectedRuns: 2 }
  const runs = improvement(plan)
  const observation = run({ ...plan, mode: "observe", final: failed })
  expect(campaign(runs, [plan], 3)).toMatchObject({ complete: false, passed: false })
  expect(campaign([...runs, observation], [plan], 3)).toMatchObject({ complete: true, passed: true })
  for (const outcome of ["timeout", "invalid", "failed"]) {
    const report = campaign([...runs, { ...observation, outcome }], [plan], 3)
    expect(report).toMatchObject({ complete: false, passed: false })
    expect(report.groups[0]?.acceptance.passed).toBe(true)
  }
  expect(campaign([...runs, observation, observation], [plan], 4)).toMatchObject({ complete: false, passed: false })
  expect(campaign([...runs, observation], [plan], 2)).toMatchObject({ complete: false, passed: false })
  expect(campaign(runs, [plan], 0)).toMatchObject({ complete: false, passed: false })
  const report = markdown(runs, "model", "evaluator", 2, { plans: [plan], expectedExecutions: 3 })
  expect(report).toContain("Campaign acceptance: **failed**")
  expect(report).toContain("Execution collection: **incomplete or invalid** (2/3)")
})

test("unknown repair baselines retain repair counts without inventing repair improvements", () => {
  const runs = improvement()
  const repair = { ...runs[1]!, initial: failed, repairs: 1, repairBaselineKnown: false }
  expect(summarize([repair])[1]).toMatchObject({
    repaired: 1,
    unknownBaseline: 1,
    improved: 0,
    unnecessary: 0,
    degraded: 0,
    ineffective: 0,
  })
  expect(acceptance([runs[0]!, repair], 2).reasons).toContain("unknown_repair_baseline")
  expect(acceptance([runs[0]!, { ...runs[1]!, repairBaselineKnown: false }], 2).passed).toBe(true)
  expect(summarize([{ ...repair, repairBaselineKnown: undefined }])[1]).toMatchObject({
    unknownBaseline: 0,
    improved: 1,
  })
})

test("coding reports preserve stable model identities, splits and separately measured oracle work", () => {
  const plan = { pairID: "first", experiment: "verification", split: "held-out" as const, expectedRuns: 2 }
  const runs = improvement({
    ...plan,
    taskKind: "coding",
    family: "async-parser",
    oracleMs: 35,
    changes: ["src/parser.ts"],
    commands: 2,
  })
  expect(summarize(runs)[1]).toMatchObject({ oracleRuns: 1, medianOracleMs: 35, changedFiles: 1, commands: 2 })
  const report = markdown(runs, "legacy-model", "legacy-evaluator", 2, {
    suite: "coding",
    signature: "sha256:fixture-v2",
    pairs: [{ id: "first", model: "router/selected", responseModel: "provider/pinned", evaluator: "jev/pinned" }],
    plans: [plan],
  })
  expect(report).toContain("| first | router/selected | provider/pinned | jev/pinned |")
  expect(report).toContain("Fixture signature: `sha256:fixture-v2`")
  expect(report).toContain("| first | verification | held-out | coding | async-parser | control |")
  expect(report).toContain("Campaign acceptance: **passed**")
  expect(report).toContain("unknown_repair_baseline")
  expect(report).not.toContain("small diagnostic sample of read-only tasks")
  expect(markdown(improvement(), "model", "evaluator", 2)).toContain("small diagnostic sample of read-only tasks")
})

test("reads cumulative reported costs once and preserves unknown and zero costs", () => {
  expect(observedCost('{"usage":{"cost":0}}')).toBe(0)
  expect(observedCost('{"usage":{"input_tokens":10}}')).toBeUndefined()
  expect(observedCost('{"usage":{"cost":-1}}')).toBeUndefined()
  expect(
    observedCost(
      'data: {"usage":{"cost":0.1}}\ndata: {"usage":{"cost":0.2}}\ndata: {"model":"keepalive","usage":{"cost":99}}\ndata: [DONE]\n',
    ),
  ).toBe(0.2)
})

test("requires a complete valid token pair in the final non-keepalive usage payload", () => {
  expect(observedUsage('{"usage":{"prompt_tokens":10,"completion_tokens":5}}')).toBe(true)
  expect(observedUsage('{"usage":{"input_tokens":0,"output_tokens":0}}')).toBe(true)
  for (const text of [
    "{}",
    '{"usage":null}',
    '{"usage":{"cost":0}}',
    '{"usage":{"prompt_tokens":10}}',
    '{"usage":{"output_tokens":5}}',
    '{"usage":{"prompt_tokens":10,"completion_tokens":null}}',
    '{"usage":{"input_tokens":-1,"output_tokens":5}}',
    '{"usage":{"input_tokens":0.5,"output_tokens":5}}',
    '{"usage":{"input_tokens":"10","output_tokens":5}}',
    "invalid",
  ])
    expect(observedUsage(text)).toBe(false)
  expect(
    observedUsage(
      'data: {"model":"pinned"}\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\ndata: [DONE]\n',
    ),
  ).toBe(true)
  expect(
    observedUsage('data: {"usage":{"prompt_tokens":10}}\ndata: {"usage":{"completion_tokens":5}}\ndata: [DONE]\n'),
  ).toBe(false)
  expect(
    observedUsage(
      'data: {"usage":{"input_tokens":10,"output_tokens":5}}\ndata: {"usage":{"input_tokens":20}}\ndata: [DONE]\n',
    ),
  ).toBe(false)
  expect(
    observedUsage('data: {"model":"keepalive","usage":{"input_tokens":10,"output_tokens":5}}\ndata: [DONE]\n'),
  ).toBe(false)
})

test("records the actual model, final token usage and cost from nested Responses stream events", () => {
  const text = [
    "event: response.created",
    'data: {"type":"response.created","response":{"model":"responses-pinned","usage":{"input_tokens":0,"output_tokens":0,"cost":0}}}',
    "",
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","delta":"data: fixture text"}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"model":"responses-pinned","usage":{"input_tokens":100,"output_tokens":20,"cost":0.012}}}',
    "",
    "data: [DONE]",
  ].join("\n")
  expect(observedModels(text)).toEqual(["responses-pinned"])
  expect(observedUsage(text)).toBe(true)
  expect(observedCost(text)).toBe(0.012)
  const created =
    'data: {"type":"response.created","response":{"model":"responses-pinned","usage":{"input_tokens":0,"output_tokens":0,"cost":0}}}\n'
  expect(observedModels(created)).toEqual(["responses-pinned"])
  expect(observedUsage(created)).toBe(false)
  expect(observedCost(created)).toBeUndefined()
  expect(
    observedUsage(
      'data: {"type":"response.completed","response":{"model":"responses-pinned","usage":{"input_tokens":100}}}\n',
    ),
  ).toBe(false)
})

test("records ordinary nonstream Responses JSON while preserving free and unknown charges", () => {
  const text =
    '{"object":"response","status":"completed","model":"responses-pinned","output":[],"usage":{"input_tokens":100,"output_tokens":20,"cost":0}}'
  expect(observedModels(text)).toEqual(["responses-pinned"])
  expect(observedUsage(text)).toBe(true)
  expect(observedCost(text)).toBe(0)
  const unpriced =
    '{"object":"response","status":"completed","model":"responses-pinned","usage":{"input_tokens":100,"output_tokens":20}}'
  expect(observedUsage(unpriced)).toBe(true)
  expect(observedCost(unpriced)).toBeUndefined()
  expect(observedUsage('{"object":"response","status":"completed","model":"responses-pinned","usage":null}')).toBe(
    false,
  )
})

test("recording proxy preserves error status and streams complete response metrics without credentials", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response('data: {"model":"pinned"}\n\ndata: [DONE]\n', {
        status: 429,
        headers: { "content-type": "text/event-stream" },
      }),
  })
  const metrics: RequestMetric[] = []
  const recorder = proxy(upstream.url.href, { run: "fixture" }, metrics)
  try {
    const response = await fetch(new URL("v1/chat/completions", recorder.url), {
      method: "POST",
      headers: { Authorization: "Bearer fixture-secret" },
      body: '{"model":"requested"}',
    })
    expect(response.status).toBe(429)
    const text = await response.text()
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({
      run: "fixture",
      model: "requested",
      status: 429,
      bytes: Buffer.byteLength(text),
      complete: true,
      responseModels: ["pinned"],
      usageKnown: false,
    })
    expect(metrics[0].firstByteMs).toBeGreaterThanOrEqual(metrics[0].headersMs!)
    expect(metrics[0].durationMs).toBeGreaterThanOrEqual(metrics[0].firstByteMs!)
    expect(JSON.stringify(metrics)).not.toContain("fixture-secret")
  } finally {
    recorder.stop(true)
    upstream.stop(true)
  }
})

test("recording proxy distinguishes HTTP 200 complete, absent and partial token usage", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(
        JSON.stringify({
          model: "pinned",
          ...(new URL(request.url).pathname === "/complete"
            ? { usage: { prompt_tokens: 10, completion_tokens: 5 } }
            : new URL(request.url).pathname === "/partial"
              ? { usage: { input_tokens: 10 } }
              : {}),
        }),
      ),
  })
  const metrics: RequestMetric[] = []
  const recorder = proxy(upstream.url.href, { run: "fixture" }, metrics)
  try {
    await Promise.all(
      ["complete", "absent", "partial"].map(async (path) => {
        const response = await fetch(new URL(path, recorder.url))
        expect(response.status).toBe(200)
        await response.text()
      }),
    )
    expect(metrics).toHaveLength(3)
    expect(metrics.find((request) => request.path === "/complete")).toMatchObject({ complete: true, usageKnown: true })
    expect(metrics.find((request) => request.path === "/absent")).toMatchObject({ complete: true, usageKnown: false })
    expect(metrics.find((request) => request.path === "/partial")).toMatchObject({ complete: true, usageKnown: false })
  } finally {
    recorder.stop(true)
    upstream.stop(true)
  }
})

test(
  "recording proxy preserves final usage after a streaming gap longer than Bun's default idle timeout",
  async () => {
    const body = [
      'data: {"model":"pinned"}\n\n',
      'data: {"model":"pinned","usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.25}}\n\ndata: [DONE]\n\n',
    ]
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode(body[0]))
              await Bun.sleep(11_000)
              controller.enqueue(new TextEncoder().encode(body[1]))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    })
    const metrics: RequestMetric[] = []
    const recorder = proxy(upstream.url.href, { run: "quiet-stream" }, metrics)
    try {
      const response = await fetch(new URL("v1/chat/completions", recorder.url))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(body.join(""))
      expect(metrics).toHaveLength(1)
      expect(metrics[0]).toMatchObject({
        status: 200,
        bytes: Buffer.byteLength(body.join("")),
        complete: true,
        responseModels: ["pinned"],
        usageKnown: true,
        costUsd: 0.25,
      })
      expect(metrics[0].durationMs).toBeGreaterThanOrEqual(11_000)
    } finally {
      recorder.stop(true)
      upstream.stop(true)
    }
  },
  25_000,
)
