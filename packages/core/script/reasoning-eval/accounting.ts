import { Intelligence } from "@opencode/schema/intelligence"
import { RequestMetric } from "./transport"

/** Missing or partial charges stay unknown unless a complete successful run has explicit pricing. */
export function cost(requests: readonly RequestMetric[], estimate?: number): number | undefined {
  if (!requests.length || requests.some((request) => !request.complete)) return undefined
  if (
    requests.every(
      (request) => request.costUsd !== undefined && Number.isFinite(request.costUsd) && request.costUsd >= 0,
    )
  ) {
    const total = requests.reduce((sum, request) => sum + request.costUsd!, 0)
    return Number.isFinite(total) ? total : undefined
  }
  if (requests.some((request) => request.status < 200 || request.status >= 300 || request.usageKnown !== true))
    return undefined
  return estimate !== undefined && Number.isFinite(estimate) && estimate >= 0 ? estimate : undefined
}

/** Estimate all evaluator work only when every recorded evaluation has usable usage evidence. */
export function evaluatorEstimate(
  evaluations: readonly Intelligence.Evaluation[],
  rates?: { input: number; output: number },
): number | undefined {
  if (!rates || !Number.isFinite(rates.input) || rates.input < 0 || !Number.isFinite(rates.output) || rates.output < 0)
    return undefined
  if (!evaluations.some((evaluation) => evaluation.operation === "response_quality")) return undefined
  if (
    evaluations.some(
      (evaluation) =>
        evaluation.decision === "unavailable" ||
        !evaluation.evaluator ||
        !Number.isInteger(evaluation.usage.input_tokens) ||
        evaluation.usage.input_tokens < 0 ||
        !Number.isInteger(evaluation.usage.output_tokens) ||
        evaluation.usage.output_tokens < 0,
    )
  )
    return undefined
  const total =
    evaluations.reduce(
      (sum, evaluation) =>
        sum + evaluation.usage.input_tokens * rates.input + evaluation.usage.output_tokens * rates.output,
      0,
    ) / 1_000_000
  return Number.isFinite(total) ? total : undefined
}
