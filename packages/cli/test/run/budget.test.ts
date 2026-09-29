import { expect, test } from "bun:test"
import { budgetLimits } from "../../src/run/run"

test("run budget flags parse dollars and token counts", () => {
  expect(budgetLimits({})).toEqual({})
  expect(budgetLimits({ maxCost: "$2.50" })).toEqual({ maxCostUsd: 2.5 })
  expect(budgetLimits({ maxCost: "2,50" })).toEqual({ maxCostUsd: 2.5 })
  expect(budgetLimits({ maxTokens: "500k" })).toEqual({ maxTokens: 500_000 })
  expect(budgetLimits({ maxCost: "3", maxTokens: "2m" })).toEqual({ maxCostUsd: 3, maxTokens: 2_000_000 })
})

test("a value that is not a limit fails before the run starts", () => {
  expect(() => budgetLimits({ maxCost: "lots" })).toThrow("--max-cost")
  expect(() => budgetLimits({ maxCost: "0" })).toThrow("--max-cost")
  expect(() => budgetLimits({ maxTokens: "many" })).toThrow("--max-tokens")
})
