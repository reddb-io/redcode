import { expect, test } from "bun:test"
import { Schema } from "effect"
import { CostAssessment } from "../src/cost-assessment.js"
import { SessionBudget } from "../src/session-budget.js"

test("cost provenance omits absent metadata and preserves known zero coverage", () => {
  expect(
    Schema.encodeSync(CostAssessment.Info)({ status: "reported", reason: undefined, catalogDigest: undefined }),
  ).toEqual({ status: "reported" })
  expect(
    Schema.decodeUnknownSync(CostAssessment.Info)({ status: "unknown", reason: "missing-usage", catalogDigest: "sha" }),
  ).toEqual({ status: "unknown", reason: "missing-usage", catalogDigest: "sha" })
  expect(
    Schema.decodeUnknownSync(CostAssessment.Coverage)({ reported: 0, estimated: 0, unknown: 0, legacy: 0 }),
  ).toEqual({ reported: 0, estimated: 0, unknown: 0, legacy: 0 })
})

test("cost coverage rejects negative and fractional accounting counts", () => {
  const decode = Schema.decodeUnknownSync(CostAssessment.Coverage)
  expect(() => decode({ reported: -1, estimated: 0, unknown: 0, legacy: 0 })).toThrow()
  expect(() => decode({ reported: 0, estimated: 0.5, unknown: 0, legacy: 0 })).toThrow()
  expect(() => Schema.decodeUnknownSync(CostAssessment.Info)({ status: "billed" })).toThrow()
})

test("public cost contracts keep stable distinct identifiers", () => {
  expect(CostAssessment.Info.ast.annotations?.identifier).toBe("CostAssessment.Info")
  expect(CostAssessment.Coverage.ast.annotations?.identifier).toBe("CostAssessment.Coverage")
  expect(CostAssessment.Summary.ast.annotations?.identifier).toBe("CostAssessment.Summary")
})

test("aggregate provenance distinguishes an empty ledger from historical and unpriced usage", () => {
  const base = {
    limits: {},
    override: {},
    spent: { cost: 0, tokens: 0, unpriced: 0 },
    exceeded: false,
    unknown: false,
    reason: "",
  }
  expect(Schema.encodeSync(SessionBudget.View)({ ...base, costAssessment: undefined })).toEqual(base)
  for (const status of ["empty", "reported", "estimated", "unknown", "legacy"] as const) {
    expect(
      Schema.decodeUnknownSync(SessionBudget.View)({ ...base, costAssessment: { status } }).costAssessment,
    ).toEqual({ status })
  }
  expect(() => Schema.decodeUnknownSync(CostAssessment.Summary)({ status: "billed" })).toThrow()
})
