import { describe, expect, test } from "bun:test"
import { ModelChoice } from "@reddb-io/redcode-core/model-choice"

const entry = (
  providerID: string,
  id: string,
  released: string,
  extra: Partial<ModelChoice.Entry> = {},
): ModelChoice.Entry => ({
  providerID,
  id,
  name: id,
  provider: providerID === "zeta" ? "Zeta" : "Alpha",
  released,
  reasoning: false,
  toolCall: true,
  attachments: false,
  variants: [],
  limit: { context: 100_000, output: 10_000 },
  ...extra,
})

const entries = [
  entry("zeta", "zeta-2", "2025-06-01", { family: "zeta", reasoning: true, variants: ["low", "high"] }),
  entry("zeta", "zeta-1", "2025-01-01", { family: "zeta" }),
  entry("alpha", "alpha-large", "2025-05-01", { cost: { input: 1, output: 4 } }),
]

describe("ModelChoice.search", () => {
  test("lists the caller's provider first, newest first and one per family", () => {
    const result = ModelChoice.search(entries, {}, "zeta")
    const output = result.type === "page" ? result.output : ""
    expect(output.indexOf("zeta/zeta-2")).toBeLessThan(output.indexOf("alpha/alpha-large"))
    expect(output).not.toContain("zeta/zeta-1 ")
    expect(output).toContain("variants: low, high")
    expect(output).toContain("$1 input, $4 output per 1M tokens")
    expect(result).toMatchObject({ total: 2, count: 2 })
  })

  test("pages with a cursor and refuses one it did not hand out", () => {
    expect(ModelChoice.search(entries, { all: true, limit: 2 })).toMatchObject({ total: 3, count: 2, next: "2" })
    expect(ModelChoice.search(entries, { cursor: "next" })).toMatchObject({ type: "invalid" })
  })
})

describe("ModelChoice.closest", () => {
  test("finds ids by fuzzy match, then by shared words", () => {
    expect(ModelChoice.closest(["zeta/zeta-2", "alpha/alpha-large"], "zeta2")[0]).toBe("zeta/zeta-2")
    expect(ModelChoice.closest(["zeta/zeta-2", "alpha/alpha-large"], "large alpah")).toContain("alpha/alpha-large")
  })

  test("parses providerID/modelID at the first slash", () => {
    expect(ModelChoice.parse(" openrouter/anthropic/claude ")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude",
    })
  })
})
