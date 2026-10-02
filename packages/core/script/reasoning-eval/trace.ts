import { Intelligence } from "@opencode/schema/intelligence"
import { SessionMessage } from "@opencode/schema/session-message"
import { IntelligenceCodeRepair } from "../../src/intelligence/code-repair"
import { IntelligenceResponse } from "../../src/intelligence/response"
import { SessionTaskFacts } from "../../src/session/task-facts"

/** A fresh benchmark Session has one classifier; its record also accounts for failed evaluations. */
export function evaluationsSettled(
  mode: Intelligence.Reasoning,
  evaluations: ReadonlyArray<Intelligence.Evaluation>,
  pendingObservations: number | undefined,
) {
  if (mode === "single") return true
  if (mode === "observe") return pendingObservations === 0
  return evaluations.some((evaluation) => evaluation.operation === "prompt_classification")
}

export function trace(
  messages: ReadonlyArray<SessionMessage.Info>,
  evaluations: ReadonlyArray<Intelligence.Evaluation>,
  directory: string,
) {
  const reviews = evaluations.filter((evaluation) => evaluation.operation === "response_quality")
  const at = messages.findIndex(
    (message) => message.type === "synthetic" && message.metadata?.[IntelligenceCodeRepair.KEY] !== undefined,
  )
  const repair = messages[at]
  const state = IntelligenceCodeRepair.state(messages)
  const results = SessionTaskFacts.project(messages, directory)
  return {
    reviews: reviews.length,
    inconclusiveReviews: reviews.filter((evaluation) => evaluation.decision === "inconclusive").length,
    suspectedCodeDefects: reviews.filter((evaluation) => IntelligenceCodeRepair.issues(evaluation).length > 0).length,
    repairAdmissions: messages.filter(
      (message) => message.type === "synthetic" && message.metadata?.[IntelligenceResponse.REPAIR_KEY] !== undefined,
    ).length,
    codeRepairAdmissions: at >= 0 ? 1 : 0,
    codeRepairAttempts: at >= 0 ? messages.slice(at + 1).filter((message) => message.type === "assistant").length : 0,
    postRepairTestCalls: repair
      ? results.filter(
          (result) =>
            messages.slice(at + 1).some((message) => message.id === result.messageID) &&
            result.tool === "shell" &&
            result.settled,
        ).length
      : 0,
    freshSuccessfulTest: state ? IntelligenceCodeRepair.verified(results, state.scope) : null,
  }
}
