// The harness through the real legacy loop: the outcomes a run can end in when the provider or
// the fixture misbehaves. Scripted provider only; nothing here reaches a network.
import { describe, expect, test } from "bun:test"
import { EvalHarness } from "../lib/harness"
import { EvalOptions } from "../lib/options"

const options = EvalOptions.parse({ REDCODE_EVAL_HISTORY: "/dev/null/history.jsonl" })
const run = (name: string, spec: EvalHarness.Spec) =>
  EvalHarness.run({ name, spec, options, inspect: async (outcome) => outcome })

describe("eval harness outcomes", () => {
  test(
    "a measured scripted run completes with cost from the usage accounting",
    async () => {
      const outcome = await run("harness-complete", {
        prompt: "say hi",
        files: { "README.md": "hello\n" },
        cassette: {
          version: 1,
          name: "inline",
          source: "test",
          steps: [
            { tools: [{ name: "read", input: { filePath: "{{workspace}}/README.md" } }], usage: { input: 1000, output: 100 } },
            { text: "The readme says hello.", usage: { input: 1200, output: 20 } },
          ],
        },
        budget: { steps: 4, ms: 30_000 },
      })
      expect(outcome.record).toMatchObject({ outcome: "completed", steps: 2, text: "The readme says hello." })
      expect(outcome.record.tools.map((call) => `${call.tool}:${call.status}`)).toEqual(["read:completed"])
      // 2200 input tokens at $1/M and 120 output tokens at $4/M.
      expect(outcome.record.cost).toBeCloseTo(0.00268, 6)
      expect(outcome.record.requests.filter((request) => request.kind === "step")).toHaveLength(2)
    },
    60_000,
  )

  test(
    "a provider that answers without usage leaves the run unmeasured, not free",
    async () => {
      const outcome = await run("harness-unmeasured", {
        prompt: "say hi",
        cassette: { version: 1, name: "inline", source: "test", steps: [{ text: "hi" }] },
        budget: { steps: 2, ms: 30_000 },
      })
      expect(outcome.record).toMatchObject({ outcome: "unmeasured", cost: null })
    },
    60_000,
  )

  test(
    "a provider error and an exhausted script both crash the run",
    async () => {
      const rejected = await run("harness-provider-error", {
        prompt: "say hi",
        cassette: { version: 1, name: "inline", source: "test", steps: [{ error: { status: 400, message: "invalid request" } }] },
        budget: { steps: 2, ms: 30_000 },
      })
      expect(rejected.record.outcome).toBe("crashed")
      const exhausted = await run("harness-exhausted", {
        prompt: "say hi",
        cassette: {
          version: 1,
          name: "inline",
          source: "test",
          steps: [{ tools: [{ name: "read", input: { filePath: "{{workspace}}/missing" } }], usage: { input: 10, output: 1 } }],
        },
        budget: { steps: 4, ms: 30_000 },
      })
      expect(exhausted.record).toMatchObject({ outcome: "crashed" })
      expect(exhausted.record.reason).toContain("no step for request")
    },
    90_000,
  )

  test(
    "a missing fixture crashes in setup without calling the model",
    async () => {
      const outcome = await run("harness-missing-fixture", {
        prompt: "say hi",
        fixture: "does-not-exist",
        cassette: { version: 1, name: "inline", source: "test", steps: [] },
      })
      expect(outcome.record.outcome).toBe("crashed")
      expect(outcome.record.reason).toContain("fixture not found")
    },
    30_000,
  )
})
