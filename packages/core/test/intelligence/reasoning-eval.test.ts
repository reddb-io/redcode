import { expect, test } from "bun:test"
import { acceptance, pairs, score, summarize, type Run } from "../../script/reasoning-eval/report"
import { observedCost, observedModels, proxy, type RequestMetric } from "../../script/reasoning-eval/transport"

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

test("grades exact facts independently of key order, retaining format and extra-field failures", () => {
  expect(score('{"nested":{"b":2,"a":1},"unknown":null}', { unknown: null, nested: { a: 1, b: 2 } }).pass).toBe(true)
  expect(score("{}", { unknown: null }).failed).toEqual(["unknown"])
  expect(score('{"ok":true,"claim":"verified"}', { ok: true }).score).toBe(0.5)
  expect(score('```json\n{"ok":true}\n```', { ok: true }).format).toBe(false)
  expect(score('{"list":[2,1]}', { list: [1, 2] }).pass).toBe(false)
})

test("failures remain in the denominator and unknown prices remain incomplete", () => {
  const summary = summarize([run(), run({ outcome: "timeout" }), run({ outcome: "invalid" })])[0]
  expect(summary.passRate).toBe(1 / 3)
  expect(summary.meanScore).toBe(1 / 3)
  expect(summary.costComplete).toBe(false)
  expect(summary.s2Tokens).toBe(300)
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
    })
    expect(metrics[0].firstByteMs).toBeGreaterThanOrEqual(metrics[0].headersMs!)
    expect(metrics[0].durationMs).toBeGreaterThanOrEqual(metrics[0].firstByteMs!)
    expect(JSON.stringify(metrics)).not.toContain("fixture-secret")
  } finally {
    recorder.stop(true)
    upstream.stop(true)
  }
})
