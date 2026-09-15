import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { EvalPilot } from "../lib/pilot"
import { EvalOptions, SCRIPTED_MODEL } from "../lib/options"
import { EvalJudge } from "../lib/judge"
import { EvalRecord } from "../lib/record"
import { parseArgs, selectFiles } from "../run"

const catalog = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "..", "test", "tool", "fixtures", "models-api.json"), "utf8"))

describe("pilot estimate", () => {
  test("prices request and answer bytes at four bytes a token", () => {
    const estimate = EvalPilot.estimate(
      [
        { requestBytes: 40_000, responseBytes: 400 },
        { requestBytes: 44_000, responseBytes: 800 },
      ],
      { input: 3, output: 15 },
    )
    // 21_000 input tokens at $3/M + 300 output tokens at $15/M
    expect(estimate).toEqual({ requests: 2, inputTokens: 21_000, outputTokens: 300, usd: 0.0675 })
    expect(EvalPilot.estimate([], { input: 1, output: 1 }).usd).toBe(0)
    expect(EvalPilot.tokens(1)).toBe(1)
  })

  test("reads pricing and family from a models.dev catalog, provider ids with slashes included", () => {
    expect(EvalPilot.lookup(catalog, "requesty/xai/grok-4")).toEqual({
      pricing: { input: 3, output: 15, cacheRead: 0.75 },
      family: "grok",
    })
    expect(EvalPilot.lookup(catalog, "requesty/not-a-model")).toBeUndefined()
    expect(EvalPilot.lookup(catalog, "no-slash")).toBeUndefined()
    expect(EvalPilot.pricingFrom({ cost: { input: "free" } })).toBeUndefined()
  })

  test("--catalog picks tool-calling models, cheapest first", () => {
    const models = EvalPilot.catalogModels(catalog, "requesty", 3)
    expect(models.length).toBeGreaterThan(0)
    const prices = models.map((model) => {
      const pricing = EvalPilot.lookup(catalog, model)!.pricing!
      return pricing.input + pricing.output
    })
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(EvalPilot.catalogModels(catalog, "no-such-provider")).toEqual([])
  })
})

describe("options", () => {
  test("defaults to the scripted replay", () => {
    const history = path.join("/work", ".red", "code", "eval", "history.jsonl")
    expect(EvalOptions.parse({}, "/work")).toMatchObject({
      mode: "scripted",
      model: SCRIPTED_MODEL,
      pilot: false,
      hermetic: false,
      history,
    })
    expect(EvalOptions.pilotPath(history)).toBe(path.join("/work", ".red", "code", "eval", "pilot.jsonl"))
  })

  test("a real model needs the live switch and a budget, unless it is only piloted", () => {
    expect(() => EvalOptions.parse({ REDCODE_EVAL_MODEL: "openrouter/qwen/qwen3" })).toThrow("REDCODE_EVAL_LIVE=1")
    expect(() => EvalOptions.parse({ REDCODE_EVAL_LIVE: "1", REDCODE_EVAL_MODEL: "openrouter/qwen/qwen3" })).toThrow("budget")
    expect(() => EvalOptions.parse({ REDCODE_EVAL_LIVE: "1", REDCODE_EVAL_BUDGET_USD: "1" })).toThrow("--model")
    expect(() => EvalOptions.parse({ REDCODE_EVAL_BUDGET_USD: "-2" })).toThrow("positive")
    expect(
      EvalOptions.parse({ REDCODE_EVAL_LIVE: "1", REDCODE_EVAL_MODEL: "openrouter/qwen/qwen3", REDCODE_EVAL_BUDGET_USD: "2", REDCODE_EVAL_RECORD: "1" }),
    ).toMatchObject({ mode: "live", budgetUsd: 2, record: true })
    // A pilot replays the cassette and prices it; it never goes live even with the switch on.
    expect(EvalOptions.parse({ REDCODE_EVAL_PILOT: "1", REDCODE_EVAL_LIVE: "1", REDCODE_EVAL_MODEL: "openrouter/qwen/qwen3" })).toMatchObject({
      mode: "scripted",
      pilot: true,
    })
    expect(EvalOptions.parse({ REDCODE_EVAL_RECORD: "1" }).record).toBe(false)
  })

  test("runner flags", () => {
    expect(parseArgs(["--model", "a/b,c/d", "--model=e/f", "--hermetic", "--baseline", "best", "edit"])).toMatchObject({
      models: ["a/b", "c/d", "e/f"],
      hermetic: true,
      baseline: "best",
      names: ["edit"],
    })
    expect(() => parseArgs(["--budget"])).toThrow("needs a value")
    expect(() => parseArgs(["--yolo"])).toThrow("unknown flag")
    const files = ["/e/a-edit.eval.ts", "/e/failing-test-recovery.eval.ts", "/e/mcp-tool-search.eval.ts"]
    expect(selectFiles(files, { smoke: true, names: [] })).toEqual(files.slice(1))
    expect(selectFiles(files, { smoke: false, names: ["edit"] })).toEqual(["/e/a-edit.eval.ts"])
    expect(selectFiles(files, { smoke: false, names: [] })).toEqual(files)
  })
})

describe("judge", () => {
  test("families come from the catalog or the slug", () => {
    expect(EvalJudge.familyOf("anthropic/claude-opus-5")).toBe("claude")
    expect(EvalJudge.familyOf("openrouter/z-ai/glm-5.3-flash")).toBe("glm")
    expect(EvalJudge.familyOf("openrouter/qwen/qwen3-coder")).toBe("qwen")
    expect(EvalJudge.familyOf("requesty/xai/grok-4", "grok")).toBe("grok")
    expect(EvalJudge.familyOf("acme/zephyr-7b")).toBe("zephyr")
    expect(EvalJudge.sameFamilyWarning("anthropic/claude-sonnet-5", "openrouter/anthropic/claude-haiku-5")).toContain("both claude")
    expect(EvalJudge.sameFamilyWarning("openai/gpt-5", "openrouter/qwen/qwen3")).toBeUndefined()
  })

  test("parses scores, clamps them, zeroes missing criteria and weighs the verdict", () => {
    const rubric = { criteria: [{ name: "correct", description: "", weight: 3 }, { name: "concise", description: "" }] }
    const scores = EvalJudge.parse('Sure! {"scores":[{"name":"correct","score":1.4,"reason":"works"}]}', rubric)
    expect(scores).toEqual([
      { name: "correct", score: 1, reason: "works" },
      { name: "concise", score: 0, reason: "the judge did not score this criterion" },
    ])
    expect(EvalJudge.weigh(scores, rubric)).toBe(0.75)
    expect(() => EvalJudge.parse("no json here", rubric)).toThrow("not JSON")
  })

  test("judges through the injected transport and warns on a same-family judge", async () => {
    const run = EvalRecord.build({
      eval: "e",
      model: "openrouter/anthropic/claude-haiku-5",
      mode: "live",
      hermetic: false,
      durationMs: 1,
      guards: [],
      messages: [],
    })
    const prompts: string[] = []
    const verdict = await EvalJudge.judge({
      run,
      task: "fix the test",
      rubric: { criteria: [{ name: "fixed", description: "the test passes" }], threshold: 0.5 },
      transport: {
        model: "anthropic/claude-sonnet-5",
        complete: async (prompt) => {
          prompts.push(prompt)
          return '{"scores":[{"name":"fixed","score":0.6,"reason":"ok"}]}'
        },
      },
    })
    expect(verdict).toMatchObject({ pass: true, score: 0.6 })
    expect(verdict.warnings[0]).toContain("favour its own family")
    expect(prompts[0]).toContain("fix the test")
    expect(prompts[0]).toContain("- fixed: the test passes")
  })
})
