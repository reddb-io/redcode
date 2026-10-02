import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceCodeRepair } from "../../src/intelligence/code-repair"
import { IntelligenceEvaluation } from "../../src/intelligence/evaluation"
import { codingCases } from "./coding-cases"

/** Labels belong to grading only. The model sees the contract and candidate implementation. */
export const detectorCases = codingCases.flatMap((item) =>
  [false, true].map((expectedDefect) => {
    const files = expectedDefect ? item.files : { ...item.files, ...item.reference }
    const sources = item.editable.map((file) => ({ file, patch: files[file]! }))
    return {
      id: `${item.id}-${expectedDefect ? "defective" : "correct"}`,
      family: item.family,
      split: item.split,
      expectedDefect,
      fixture: { ...item, files },
      request: {
        model: "",
        state: {
          sources: {
            request: item.prompt,
            artifact: IntelligenceCodeRepair.artifact({
              from: "fixed-input",
              to: IntelligenceEvaluation.fingerprint(sources),
              files: sources,
            }),
          },
        },
        questions: IntelligenceCodeRepair.QUESTIONS,
      },
    }
  }),
)

export type Detection = {
  expectedDefect: boolean
  answers?: Record<string, Intelligence.Answer>
  costUsd?: number
}

export function summarizeDetection(rows: ReadonlyArray<Detection>, threshold = Intelligence.REPAIR_CONFIDENCE) {
  const predicted = (row: Detection) =>
    row.answers !== undefined &&
    Object.keys(IntelligenceCodeRepair.QUESTIONS).some((id) => {
      const answer = row.answers?.[id]
      return answer?.type === "noul" && answer.noul >= threshold
    })
  const available = rows.filter((row) => row.answers !== undefined)
  const truePositive = available.filter((row) => row.expectedDefect && predicted(row)).length
  const falsePositive = available.filter((row) => !row.expectedDefect && predicted(row)).length
  const falseNegative = available.filter((row) => row.expectedDefect && !predicted(row)).length
  const trueNegative = available.filter((row) => !row.expectedDefect && !predicted(row)).length
  return {
    threshold,
    candidates: rows.length,
    available: available.length,
    unavailable: rows.length - available.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null,
    falsePositiveRate: falsePositive + trueNegative ? falsePositive / (falsePositive + trueNegative) : null,
    effectiveRecall: rows.some((row) => row.expectedDefect)
      ? truePositive / rows.filter((row) => row.expectedDefect).length
      : null,
    knownCostUsd: rows.reduce((total, row) => total + (row.costUsd ?? 0), 0),
    costComplete: rows.length > 0 && rows.every((row) => row.costUsd !== undefined),
  }
}
