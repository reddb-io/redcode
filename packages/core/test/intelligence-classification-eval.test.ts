import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Response } from "@reddb-io/redcode-schema/intelligence"
import { clarification, parseArgs, score, summarize } from "../script/evaluate-prompt-classification"

const fixture = {
  id: "deadline-fix",
  prompt: "Fix the blocked build today.",
  expected: {
    work_route: "local_change",
    change_kind: "bugfix",
    impact: { min: 1.5, max: 2.5 },
    time_pressure: "deadline",
    interaction_constraint: "execute",
    clarification: "proceed" as const,
    complexity: { min: 1, max: 2 },
    consequence: { min: 0.5, max: 1.5 },
    frustration: { min: 0, max: 1 },
    priority: "high" as const,
  },
}

const response = Schema.decodeUnknownSync(Response)({
  model: "jev-test",
  answers: {
    work_route: {
      type: "choice",
      choice: "local_change",
      confidence: 0.9,
      probabilities: { local_change: 0.9, investigation: 0.1 },
    },
    change_kind: { type: "choice", choice: "bugfix", confidence: 1, probabilities: { bugfix: 1 } },
    impact: {
      type: "score",
      score: 2,
      confidence: 0.8,
      probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
      legend: { "0": "none", "1": "limited", "2": "blocked", "3": "critical" },
    },
    time_pressure: { type: "choice", choice: "deadline", confidence: 0.9, probabilities: { deadline: 0.9 } },
    interaction_constraint: { type: "choice", choice: "execute", confidence: 1, probabilities: { execute: 1 } },
    must_clarify: { type: "noul", noul: 0.1 },
    complexity: {
      type: "score",
      score: 1.5,
      confidence: 0.5,
      probabilities: { "1": 0.5, "2": 0.5 },
      legend: { "1": "focused", "2": "multi-step" },
    },
    consequence: {
      type: "score",
      score: 1,
      confidence: 1,
      probabilities: { "1": 1 },
      legend: { "1": "local" },
    },
    frustration: {
      type: "score",
      score: 0,
      confidence: 1,
      probabilities: { "0": 1 },
      legend: { "0": "calm" },
    },
  },
  usage: { input_tokens: 100, output_tokens: 20 },
})

test("classification eval arguments support repeated multi-provider runs", () => {
  expect(parseArgs([])).toEqual({ transports: ["opencode-zen"], runs: 1, concurrency: 4, filters: [] })
  expect(
    parseArgs([
      "--transport",
      "opencode-zen,openrouter",
      "--runs=3",
      "--concurrency",
      "2",
      "--filter",
      "release",
      "--min-accuracy",
      "0.8",
    ]),
  ).toEqual({
    transports: ["opencode-zen", "openrouter"],
    runs: 3,
    concurrency: 2,
    filters: ["release"],
    minAccuracy: 0.8,
  })
  expect(() => parseArgs(["--runs", "0"])).toThrow()
  expect(() => parseArgs(["--transport", "unknown"])).toThrow()
})

test("classification eval scores labels, ranges, clarification policy, and derived priority", () => {
  expect(clarification(0.2)).toBe("proceed")
  expect(clarification(0.5)).toBe("inspect")
  expect(clarification(0.8)).toBe("ask")
  const result = score(fixture, response)
  expect(result.priority).toBe("high")
  expect(result.assertions.every((assertion) => assertion.pass)).toBe(true)
})

test("classification eval reports field accuracy, strict stability, latency, and usage", () => {
  const first = score(fixture, response)
  const second = score(fixture, {
    ...response,
    answers: {
      ...response.answers,
      work_route: {
        type: "choice",
        choice: "investigation",
        confidence: 0.6,
        probabilities: { investigation: 0.7, local_change: 0.3 },
      },
    },
  })
  const summary = summarize([
    { caseID: fixture.id, latencyMs: 10, usage: response.usage, ...first },
    { caseID: fixture.id, latencyMs: 30, usage: response.usage, ...second },
  ])
  expect(summary.accuracy).toBeLessThan(1)
  expect(summary.fields.work_route?.accuracy).toBe(0.5)
  expect(summary.stability.average).toBe(0.5)
  expect(summary.latencyMs).toEqual({ average: 20, p50: 10, p95: 30 })
  expect(summary.usage).toEqual({ input_tokens: 200, output_tokens: 40 })
})
