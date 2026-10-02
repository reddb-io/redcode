import { expect, test } from "bun:test"
import { Intelligence } from "@opencode/schema/intelligence"
import { cost, evaluatorEstimate } from "../../script/reasoning-eval/accounting"
import type { RequestMetric } from "../../script/reasoning-eval/transport"

function request(input: Partial<RequestMetric> = {}): RequestMetric {
  return {
    run: "control",
    path: "/v1/decisions",
    method: "POST",
    model: "evaluator",
    status: 200,
    headersMs: 1,
    firstByteMs: 2,
    durationMs: 3,
    bytes: 100,
    complete: true,
    responseModels: ["evaluator"],
    usageKnown: true,
    ...input,
  }
}

function evaluation(input: Partial<Intelligence.Evaluation> = {}): Intelligence.Evaluation {
  return {
    id: "evaluation",
    fingerprint: "fingerprint",
    sessionID: "session",
    operation: "response_quality",
    policy: "policy",
    decision: "accepted",
    model: "evaluator",
    answers: {},
    issues: [],
    created: 1,
    duration: 1,
    evaluator: { transport: "red-router", baseURL: "http://localhost:35555", model: "evaluator" },
    usage: { input_tokens: 10, output_tokens: 5 },
    ...input,
  }
}

test("complete reported charges include failed requests and prefer actual costs over estimates", () => {
  expect(cost([request({ costUsd: 0.1 }), request({ status: 429, costUsd: 0.2 })], 10)).toBeCloseTo(0.3)
  expect(cost([request({ status: 500, costUsd: 0, usageKnown: false })], 10)).toBe(0)
  expect(cost([request({ costUsd: 0, usageKnown: undefined })], 10)).toBe(0)
})

test("no requests and incomplete streams cannot establish a charge", () => {
  expect(cost([], 0)).toBeUndefined()
  expect(cost([request({ complete: false, costUsd: 0.1 })], 1)).toBeUndefined()
  expect(cost([request({ costUsd: 0.1 }), request({ complete: false })], 1)).toBeUndefined()
})

test("partial reported charges remain unknown unless all requests permit an explicit estimate", () => {
  const requests = [request({ costUsd: 0.1 }), request()]
  expect(cost(requests)).toBeUndefined()
  expect(cost(requests, 0.4)).toBe(0.4)
  expect(cost([request({ costUsd: 0.1 }), request({ status: 503 })], 0.4)).toBeUndefined()
  expect(cost([request({ status: 400 })], 0)).toBeUndefined()
  expect(cost([request()], 0)).toBe(0)
})

test("HTTP 200 with absent or partial token usage cannot turn default aggregate tokens into free work", () => {
  expect(cost([request({ usageKnown: false })], 0)).toBeUndefined()
  expect(cost([request({ usageKnown: undefined })], 0)).toBeUndefined()
  expect(cost([request({ costUsd: 0.1 }), request({ usageKnown: false })], 0.1)).toBeUndefined()
})

test("invalid charges and estimates are not reported as known costs", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(cost([request({ costUsd: value })])).toBeUndefined()
    expect(cost([request()], value)).toBeUndefined()
  }
})

test("evaluator estimates include classification, review, and repair usage with explicit rates", () => {
  expect(
    evaluatorEstimate(
      [
        evaluation({ operation: "prompt_classification", usage: { input_tokens: 20, output_tokens: 4 } }),
        evaluation({ usage: { input_tokens: 30, output_tokens: 6 } }),
        evaluation({ decision: "needs_revision", usage: { input_tokens: 50, output_tokens: 10 } }),
      ],
      { input: 2, output: 4 },
    ),
  ).toBeCloseTo(0.00028)
  expect(
    evaluatorEstimate([evaluation({ usage: { input_tokens: 10, output_tokens: 5, unpriced: 1 } })], {
      input: 2,
      output: 4,
    }),
  ).toBeCloseTo(0.00004)
  expect(evaluatorEstimate([evaluation()], { input: 0, output: 0 })).toBe(0)
})

test("HTTP 200 does not make malformed or unavailable evaluator responses priced", () => {
  expect(
    cost([request()], evaluatorEstimate([evaluation({ decision: "unavailable" })], { input: 1, output: 1 })),
  ).toBeUndefined()
  expect(
    cost([request()], evaluatorEstimate([evaluation({ evaluator: undefined })], { input: 1, output: 1 })),
  ).toBeUndefined()
  expect(
    evaluatorEstimate([evaluation({ operation: "prompt_classification" })], { input: 1, output: 1 }),
  ).toBeUndefined()
  expect(evaluatorEstimate([evaluation()], undefined)).toBeUndefined()
  expect(evaluatorEstimate([], { input: 1, output: 1 })).toBeUndefined()
})

test("one unavailable evaluation invalidates an otherwise valid response review estimate", () => {
  expect(
    evaluatorEstimate([evaluation(), evaluation({ operation: "prompt_classification", decision: "unavailable" })], {
      input: 1,
      output: 1,
    }),
  ).toBeUndefined()
})

test("negative, fractional, and nonfinite usage or rates cannot produce an evaluator estimate", () => {
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      evaluatorEstimate([evaluation({ usage: { input_tokens: value, output_tokens: 1 } })], { input: 1, output: 1 }),
    ).toBeUndefined()
    expect(
      evaluatorEstimate([evaluation({ usage: { input_tokens: 1, output_tokens: value } })], { input: 1, output: 1 }),
    ).toBeUndefined()
  }
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(evaluatorEstimate([evaluation()], { input: value, output: 1 })).toBeUndefined()
    expect(evaluatorEstimate([evaluation()], { input: 1, output: value })).toBeUndefined()
  }
})
