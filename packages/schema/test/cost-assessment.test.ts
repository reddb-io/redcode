import { expect, test } from "bun:test"
import { Schema } from "effect"
import { CostAssessment } from "../src/cost-assessment.js"

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
})
