import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Intelligence } from "../src/intelligence"
import { CompactionEvaluation } from "../src/session/compaction-evaluation"

test("compaction boundary rechecks new evidence and retries outages with bounded cost", async () => {
  let now = 0
  let unavailable = true
  const calls: Intelligence.EvaluationInput[] = []
  const boundary = CompactionEvaluation.boundary(
    {
      evaluate: (input) =>
        Effect.sync(() => {
          calls.push(input)
          return {
            id: String(calls.length),
            fingerprint: "test",
            sessionID: input.sessionID,
            operation: input.operation,
            policy: "test",
            decision: unavailable ? ("unavailable" as const) : ("accepted" as const),
            model: "jev",
            answers: {},
            issues: [],
            created: now,
            duration: 0,
            usage: { input_tokens: 1, output_tokens: 0 },
          }
        }),
    },
    () => now,
  )
  const input = { sessionID: "ses_boundary", userID: "msg_request", sources: ["Running validation"] }
  expect(await Effect.runPromise(boundary(input))).toBe(false)
  unavailable = false
  expect(await Effect.runPromise(boundary(input))).toBe(false)
  now += 30_000
  expect(await Effect.runPromise(boundary(input))).toBe(true)
  now += 30_000
  expect(await Effect.runPromise(boundary(input))).toBe(false)
  expect(await Effect.runPromise(boundary({ ...input, sources: ["Validation passed; work phase complete"] }))).toBe(
    true,
  )
  now += 30_000
  expect(await Effect.runPromise(boundary({ ...input, sources: ["Further evidence"] }))).toBe(false)
  expect(calls).toHaveLength(3)
  expect(await Effect.runPromise(boundary({ ...input, userID: "msg_next" }))).toBe(true)
  expect(await Effect.runPromise(boundary({ ...input, userID: "msg_large", sources: ['"'.repeat(100_000)] }))).toBe(
    true,
  )
  expect(calls.at(-1)?.sources).toMatchObject({
    truncated: true,
    reference: "ses_boundary/compaction-boundary/msg_large",
  })
  expect(JSON.stringify(calls.at(-1)).length).toBeLessThan(12_000)
})

test("partial checkpoints require every ordered nonempty section and accept CRLF", () => {
  const summary =
    "## Objective\n- Validate parser\n## Important Details\n- Keep API\n## Work State\n### Completed\n- Tests passed\n### Active\n- Review diff\n### Blocked\n- None\n## Next Move\n1. Review diff\n## Relevant Files\n- parser.ts"
  expect(CompactionEvaluation.partialError(summary)).toBeUndefined()
  expect(CompactionEvaluation.partialError(summary.replaceAll("\n", "\r\n"))).toBeUndefined()
  expect(CompactionEvaluation.partialError(summary.slice(0, summary.indexOf("## Relevant Files")))).toContain("missing")
  expect(CompactionEvaluation.partialError(summary.replace("- parser.ts", ""))).toContain("empty")
})
