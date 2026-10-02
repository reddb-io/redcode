export * as IntelligenceSatisfaction from "./satisfaction.js"

import { Intelligence } from "@opencode/schema/intelligence"
import { Satisfaction } from "@opencode/schema/satisfaction"

/** Advisory context folded from existing classifications, without another evaluation or durable score. */
export function context(
  evaluations: ReadonlyArray<Intelligence.Evaluation>,
  trips: ReadonlyArray<Satisfaction.Trip> = [],
) {
  const rated = evaluations
    .filter((evaluation) => evaluation.mode !== "observe" && Satisfaction.sample(evaluation) !== undefined)
    .toSorted((left, right) => left.created - right.created)
  const current = Satisfaction.read(rated, trips)
  const previous = Satisfaction.read(
    rated.slice(0, -1),
    trips.filter((trip) => trip.at <= (rated.at(-2)?.created ?? 0)),
  )
  const trend =
    !current || !previous
      ? "unknown"
      : current.mood - previous.mood > 0.1
        ? "improving"
        : current.mood - previous.mood < -0.1
          ? "worsening"
          : "stable"
  return [
    "<session-satisfaction>",
    JSON.stringify({
      score: current ? Math.round((current.mood + 1) * 2.5) : null,
      scale: "0=low satisfaction, 5=high satisfaction; null=insufficient reliable evidence",
      stage: current?.stage ?? "unknown",
      trend,
      samples: rated.length,
      minimum_samples: Satisfaction.MINIMUM,
      stops: current?.stops ?? 0,
      recovered: current?.recovered ?? 0,
    }),
    "This is an estimate from user feedback, frustration and recent guard interventions, not proof that the work is correct or incorrect. Unknown means no reliable conclusion; do not infer frustration from missing data.",
    "When satisfaction is low or worsening, revisit the user's corrections and tool evidence, identify what failed in the previous approach, adjust the work and verify the result. Keep progress messages concise and concrete; do not substitute apologies or agreement for corrective work.",
    "This advisory does not change the objective, permissions, mode, model, effort or budget. Explicit session instructions and deterministic safeguards still govern execution.",
    "</session-satisfaction>",
  ].join("\n")
}
