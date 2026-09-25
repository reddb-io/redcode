import { expect, test } from "bun:test"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { evaluationWarning, indicatorWarning, s1Label, transportLabel } from "../../src/component/dialog-intelligence"

const review = (decision: Intelligence.Evaluation["decision"], answers: Record<string, number>) =>
  ({
    id: "review",
    fingerprint: "review",
    sessionID: "ses",
    operation: "response_quality",
    policy: "policy",
    decision,
    model: "jev-1.13",
    answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: "noul" as const, noul }])),
    issues: Object.entries(answers).flatMap(([id, noul]) => (noul > 0.1 ? [id] : [])),
    created: 1,
    duration: 1,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) satisfies Intelligence.Evaluation
const warns = (
  evaluation: Intelligence.Evaluation | undefined,
  input: Partial<Parameters<typeof indicatorWarning>[0]> = {},
) => indicatorWarning({ ready: true, single: false, failed: false, evaluation, ...input })

test("an inconclusive review that the repair settled does not light the S1 warning", () => {
  // The review jev-1.13 gave the revised greeting: omission stayed below the repair threshold.
  const settled = review("inconclusive", { omission: 0.28, unsupported: 0.04, writing: 0.05 })
  expect(warns(settled)).toBe(false)
  expect(evaluationWarning(settled)).toBeUndefined()
  expect(warns(review("accepted", { omission: 0.02 }))).toBe(false)
  expect(warns(undefined)).toBe(false)
})

test("the S1 warning lights when S1 is not ready, unavailable, failing or left an issue unresolved", () => {
  expect(warns(undefined, { ready: false })).toBe(true)
  expect(warns(undefined, { failed: true })).toBe(true)
  const unavailable = review("unavailable", {})
  expect(warns(unavailable)).toBe(true)
  expect(evaluationWarning(unavailable)).toContain("unavailable")
  const unresolved = review("inconclusive", { unsupported: 0.8, writing: 0.05 })
  expect(warns(unresolved)).toBe(true)
  expect(evaluationWarning(unresolved)).toContain("claimed work it couldn't prove")
  const revision = review("needs_revision", { omission: 0.95 })
  expect(warns(revision)).toBe(true)
  expect(evaluationWarning(revision)).toContain("needs revision")
  expect(evaluationWarning(revision)).toContain("missed part of your request")
  // Single reasoning has no S1 to warn about once it is set up.
  expect(warns(unavailable, { single: true })).toBe(false)
})

test("the S1 footer name is the bare model, or a setup hint when S1 is not ready", () => {
  expect(s1Label({ ready: true, model: "opencode-zen/jev-1.13" })).toBe("jev-1.13")
  expect(s1Label({ ready: true, model: undefined })).toBe("S1")
  expect(s1Label({ ready: false, model: "opencode-zen/jev-1.13" })).toBe("S1 setup")
  expect(s1Label({ ready: false, model: undefined })).toBe("S1 setup")
})

test("the S1 footer route names the evaluator's transport in words", () => {
  expect(transportLabel("red-router")).toBe("RedRouter")
  expect(transportLabel("openrouter")).toBe("OpenRouter")
  expect(transportLabel(undefined)).toBeUndefined()
})
