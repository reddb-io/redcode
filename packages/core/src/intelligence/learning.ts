export * as IntelligenceLearning from "./learning.js"

import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceEvaluation } from "./evaluation.js"
import { IntelligenceResponse } from "./response.js"

/** Propose only a correction supported by before/after evaluations of different candidates. */
export function candidate(
  before: Intelligence.Evaluation | undefined,
  after: Intelligence.Evaluation,
): Intelligence.LearningCandidate | undefined {
  if (
    !before ||
    before.mode === "observe" ||
    after.mode === "observe" ||
    before.operation !== "response_quality" ||
    after.operation !== "response_quality" ||
    before.sessionID !== after.sessionID ||
    !before.subjectID ||
    before.subjectID !== after.subjectID ||
    !before.candidateID ||
    !after.candidateID ||
    before.candidateID === after.candidateID ||
    before.policy !== after.policy ||
    after.created < before.created ||
    after.decision !== "accepted"
  )
    return undefined
  const issues = IntelligenceResponse.verdict(before, []).unresolved
  if (!issues.length) return undefined
  return {
    type: "learning",
    id: IntelligenceEvaluation.fingerprint({ before: before.id, after: after.id }),
    sessionID: after.sessionID,
    subjectID: before.subjectID,
    policy: after.policy,
    created: after.created,
    status: "proposed",
    evaluations: [before.id, after.id],
    proposal: `Consider an independent ${issues.map(IntelligenceResponse.reason).join("; ")} check before declaring the result. Review the original request and both evaluation evidence artifacts before promoting this case into guidance. One corrected case does not establish a general rule.`,
  }
}
