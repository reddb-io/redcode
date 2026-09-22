export * as CompactionEvaluation from "./compaction-evaluation"

import { Effect } from "effect"
import { Intelligence } from "../intelligence"

export const questions = Intelligence.questions({
  omission:
    "Does candidate omit a still-applicable user constraint, decision, pending deliverable or blocker present in sources?",
  contradiction: "Does candidate contradict sources or present unverified work as completed?",
})

/** A cut-off answer must still contain every nonempty checkpoint section before semantic review. */
export function partialError(input: string) {
  const text = input.replaceAll("\r\n", "\n")
  const headings = [
    "## Objective",
    "## Important Details",
    "## Work State",
    "### Completed",
    "### Active",
    "### Blocked",
    "## Next Move",
    "## Relevant Files",
  ]
  const positions = headings.map((heading) => text.indexOf(heading + "\n"))
  if (positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]!)))
    return "Truncated checkpoint is missing required sections; original history was preserved"
  if (
    positions.some(
      (position, index) =>
        index !== 2 && !text.slice(position + headings[index]!.length, positions[index + 1] ?? text.length).trim(),
    )
  )
    return "Truncated checkpoint contains an empty section; original history was preserved"
}

/** Recheck changed evidence, and retry an unavailable evaluator once cooled down, within a fixed per-request budget. */
export function boundary(intelligence: Pick<Intelligence.Interface, "evaluate">, now = Date.now) {
  const checked = new Map<
    string,
    { userID: string; hash: string; attempts: number; at: number; unavailable: boolean }
  >()
  return Effect.fn("CompactionEvaluation.boundary")(function* (input: {
    sessionID: string
    userID: string
    sources: ReadonlyArray<string>
  }) {
    const previous = checked.get(input.sessionID)
    const current = previous?.userID === input.userID ? previous : undefined
    const hash = Intelligence.fingerprint(input.sources)
    if (
      current &&
      (current.attempts >= 3 || (!current.unavailable && current.hash === hash) || now() - current.at < 30_000)
    )
      return false
    const record = { userID: input.userID, hash, attempts: (current?.attempts ?? 0) + 1, at: now(), unavailable: false }
    if (!checked.has(input.sessionID) && checked.size >= 256) checked.delete(checked.keys().next().value!)
    checked.set(input.sessionID, record)
    const evaluation = yield* intelligence
      .evaluate({
        sessionID: input.sessionID,
        operation: "compact_now",
        subjectID: input.userID,
        attempt: record.attempts,
        sources: Intelligence.evidence(input.sources, {
          reference: `${input.sessionID}/compaction-boundary/${input.userID}`,
          limit: 10_000,
        }),
        candidate: "Compact at this provider-turn boundary",
        questions: Intelligence.questions({
          unsafe:
            "Is this an unsuitable boundary to compact because a work phase is still actively unfolding or its relevant evidence is incomplete? Answer no only when a phase has clearly ended and its state can be summarized. Sources are a bounded view with coverage metadata; missing or truncated evidence is unknown, never proof that work has ended.",
        }),
      })
      .pipe(Effect.catchTag("IntelligenceError", () => Effect.succeed(undefined)))
    record.unavailable = !evaluation || evaluation.decision === "unavailable"
    return evaluation?.decision === "accepted"
  })
}
