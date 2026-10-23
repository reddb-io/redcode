export * as CostAssessment from "./cost-assessment.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"

/** The numeric cost is stored alongside this provenance; unknown means that number is only a subtotal. */
export const Info = Schema.Struct({
  status: Schema.Literals(["reported", "estimated", "unknown"]),
  reason: optional(Schema.String),
  catalogDigest: optional(Schema.String),
}).annotate({ identifier: "CostAssessment.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Counts of accounting records, not provider requests or invoices. Older records stay unclassified. */
export const Coverage = Schema.Struct({
  reported: NonNegativeInt,
  estimated: NonNegativeInt,
  unknown: NonNegativeInt,
  legacy: NonNegativeInt,
}).annotate({ identifier: "CostAssessment.Coverage" })
export interface Coverage extends Schema.Schema.Type<typeof Coverage> {}

/** Classification of an aggregate. Legacy means its full provenance is unavailable; empty means no usage was recorded. */
export const Summary = Schema.Struct({
  status: Schema.Literals(["empty", "reported", "estimated", "unknown", "legacy"]),
}).annotate({ identifier: "CostAssessment.Summary" })
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
