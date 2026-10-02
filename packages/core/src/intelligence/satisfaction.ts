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
      : current.temperature - previous.temperature > 0.05
        ? "heating"
        : current.temperature - previous.temperature < -0.05
          ? "cooling"
          : "stable"
  return [
    "<session-frustration>",
    JSON.stringify({
      score: current?.score ?? null,
      scale: "0=no accumulated friction, 5=critical accumulated friction; null=insufficient reliable evidence",
      stage: current?.stage ?? "unknown",
      trend,
      samples: rated.length,
      minimum_samples: Satisfaction.MINIMUM,
      stops: current?.stops ?? 0,
      recovered: current?.recovered ?? 0,
    }),
    "This thermometer tracks accumulated friction with the agent's work across iterations, not sentiment or the user's personality or emotions. Corrections, rejected work and unresolved failures heat it; confirmed improvement cools it. Neutral continuation does not erase earlier failures. Unknown means no reliable conclusion; do not infer frustration from missing data.",
    "When temperature is high or heating, review the sequence of user corrections and failed attempts. Identify the unmet requirement, stop repeating the failed approach, make a more specific evidence-backed correction and verify the result. If the desired outcome remains ambiguous after reviewing the conversation, ask one focused clarification and continue independent work. Do not ask the user to repeat a requirement that is already clear. Keep progress concise and concrete; apologies, agreement and claimed completion are not recovery evidence.",
    "This advisory does not change the objective, permissions, mode, model, effort or budget. Explicit session instructions and deterministic safeguards still govern execution.",
    "</session-frustration>",
  ].join("\n")
}
