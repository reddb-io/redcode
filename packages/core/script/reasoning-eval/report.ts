import { Option, Schema } from "effect"

export interface Run {
  caseID: string
  round: number
  mode: "single" | "dual"
  outcome: string
  durationMs: number
  initial: ReturnType<typeof score>
  final: ReturnType<typeof score>
  repairs: number
  s1Tokens: number
  s2Tokens: number
  s2CostUsd: number
  s2Unpriced: boolean
  s1CostUsd?: number
  evaluatorFailures: number
}

export function score(text: string, expected: Readonly<Record<string, Schema.Json>>) {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))(
    text.trim(),
  )
  if (Option.isNone(decoded)) return { pass: false, score: 0, format: false, failed: ["json_format"] }
  const checks = Object.entries(expected).map(([key, value]) => ({
    key,
    pass: canonical(decoded.value[key] ?? null) === canonical(value) && Object.hasOwn(decoded.value, key),
  }))
  const extra = Object.keys(decoded.value).filter((key) => !Object.hasOwn(expected, key))
  const failed = [
    ...checks.filter((check) => !check.pass).map((check) => check.key),
    ...extra.map((key) => `unexpected:${key}`),
  ]
  return {
    pass: failed.length === 0,
    score: checks.filter((check) => check.pass).length / (checks.length + extra.length),
    format: true,
    failed,
  }
}

export function summarize(runs: ReadonlyArray<Run>) {
  return (["single", "dual"] as const).map((mode) => {
    const group = runs.filter((run) => run.mode === mode)
    const successful = group.filter((run) => run.outcome === "succeeded")
    const repaired = group.filter((run) => run.repairs > 0)
    return {
      mode,
      runs: group.length,
      succeeded: successful.length,
      passed: successful.filter((run) => run.final.pass).length,
      passRate: group.length ? successful.filter((run) => run.final.pass).length / group.length : 0,
      meanScore: group.length ? successful.reduce((sum, run) => sum + run.final.score, 0) / group.length : 0,
      medianDurationMs: percentile(
        group.map((run) => run.durationMs),
        0.5,
      ),
      p95DurationMs: percentile(
        group.map((run) => run.durationMs),
        0.95,
      ),
      s1Tokens: group.reduce((sum, run) => sum + run.s1Tokens, 0),
      s2Tokens: group.reduce((sum, run) => sum + run.s2Tokens, 0),
      s2CostUsd: group.reduce((sum, run) => sum + run.s2CostUsd, 0),
      s1CostUsd: group.reduce((sum, run) => sum + (run.s1CostUsd ?? 0), 0),
      totalCostUsd: group.reduce((sum, run) => sum + run.s2CostUsd + (run.s1CostUsd ?? 0), 0),
      costComplete:
        group.length > 0 && group.every((run) => !run.s2Unpriced && (mode === "single" || run.s1CostUsd !== undefined)),
      evaluatorFailures: group.reduce((sum, run) => sum + run.evaluatorFailures, 0),
      repaired: repaired.length,
      improved: repaired.filter((run) => !run.initial.pass && run.final.pass).length,
      unnecessary: repaired.filter((run) => run.initial.pass && run.final.pass).length,
      degraded: repaired.filter((run) => run.initial.pass && !run.final.pass).length,
      ineffective: repaired.filter((run) => !run.initial.pass && !run.final.pass).length,
    }
  })
}

/** Improvement and the 2x monetary ceiling are acceptance criteria, not token comparisons. */
export function acceptance(runs: ReadonlyArray<Run>, expectedRuns: number) {
  const [single, dual] = summarize(runs)
  const complete =
    runs.length === expectedRuns &&
    expectedRuns > 0 &&
    single!.runs === dual!.runs &&
    pairs(runs).length === single!.runs &&
    runs.every((run) => run.outcome === "succeeded")
  const costKnown = single!.costComplete && dual!.costComplete
  const ratio = !costKnown
    ? undefined
    : single!.totalCostUsd > 0
      ? dual!.totalCostUsd / single!.totalCostUsd
      : dual!.totalCostUsd === 0
        ? 1
        : undefined
  const overBudgetPairs = runs
    .filter((run) => run.mode === "single" && !run.s2Unpriced)
    .flatMap((single) => {
      const dual = runs.find((run) => run.mode === "dual" && run.caseID === single.caseID && run.round === single.round)
      return dual &&
        !dual.s2Unpriced &&
        dual.s1CostUsd !== undefined &&
        dual.s2CostUsd + dual.s1CostUsd > 2 * single.s2CostUsd
        ? [{ caseID: single.caseID, round: single.round }]
        : []
    })
  const regressedCases = [...new Set(runs.map((run) => run.caseID))].filter((id) => {
    const count = (mode: Run["mode"]) =>
      runs.filter((run) => run.caseID === id && run.mode === mode && run.outcome === "succeeded" && run.final.pass)
        .length
    return count("dual") < count("single")
  })
  const reasons = [
    ...(!complete ? ["incomplete_or_invalid_suite"] : []),
    ...(dual!.passed <= single!.passed ? ["no_accuracy_improvement"] : []),
    ...(regressedCases.length ? ["case_accuracy_regression"] : []),
    ...(dual!.degraded ? ["repair_degraded_correct_answer"] : []),
    ...(!costKnown
      ? ["unknown_total_cost"]
      : ratio === undefined || ratio > 2 || overBudgetPairs.length
        ? ["cost_above_2x"]
        : []),
  ]
  return {
    passed: reasons.length === 0,
    reasons,
    costRatio: ratio ?? null,
    maxCostRatio: 2,
    regressedCases,
    overBudgetPairs,
  }
}

export function pairs(runs: ReadonlyArray<Run>) {
  return runs
    .filter((run) => run.mode === "single")
    .flatMap((single) => {
      const dual = runs.find((run) => run.mode === "dual" && run.caseID === single.caseID && run.round === single.round)
      if (!dual) return []
      return [
        {
          caseID: single.caseID,
          round: single.round,
          singlePassed: single.outcome === "succeeded" && single.final.pass,
          dualPassed: dual.outcome === "succeeded" && dual.final.pass,
          durationDeltaMs: dual.durationMs - single.durationMs,
          tokenDelta: dual.s1Tokens + dual.s2Tokens - single.s2Tokens,
        },
      ]
    })
}

export function markdown(runs: ReadonlyArray<Run>, model: string, evaluator: string, expectedRuns = runs.length) {
  const summary = summarize(runs)
  const gate = acceptance(runs, expectedRuns)
  return [
    "# Single versus dual reasoning",
    "",
    `S2: \`${model}\`. S1: \`${evaluator}\`.`,
    "Fresh sessions, identical task fixtures and S2 selection, alternating pair order. Grades use deterministic fixture facts, independently of S1 verdicts.",
    "",
    "| Mode | Passes | Mean score | Median ms | P95 ms | S2 tokens | S1 tokens | Total USD | Repairs | Improved | Unnecessary | Degraded |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.map(
      (group) =>
        `| ${group.mode} | ${group.passed}/${group.runs} | ${group.meanScore.toFixed(3)} | ${Math.round(group.medianDurationMs)} | ${Math.round(group.p95DurationMs)} | ${group.s2Tokens} | ${group.s1Tokens} | ${group.totalCostUsd.toFixed(6)}${group.costComplete ? "" : " (incomplete)"} | ${group.repaired} | ${group.improved} | ${group.unnecessary} | ${group.degraded} |`,
    ),
    "",
    "| Case | Round | Single pass | Dual pass | Dual latency delta ms | Dual token delta |",
    "| --- | --- | --- | --- | --- | --- |",
    ...pairs(runs).map(
      (pair) =>
        `| ${pair.caseID} | ${pair.round} | ${pair.singlePassed} | ${pair.dualPassed} | ${Math.round(pair.durationDeltaMs)} | ${pair.tokenDelta} |`,
    ),
    "",
    `Acceptance: **${gate.passed ? "passed" : "failed"}**. Requires more dual passes, no case-level accuracy regression, no degraded repair, and known total cost at most 2x single. Cost ratio: ${gate.costRatio === null ? "unknown" : gate.costRatio.toFixed(3) + "x"}. Reasons: ${gate.reasons.join(", ") || "none"}.`,
    "",
    "This is a small diagnostic sample of read-only tasks, not proof of production coding effectiveness. Costs use reported upstream charges when available and explicitly supplied price estimates otherwise; they are not a billing invoice. Missing prices remain unknown and fail the cost gate. Failed and timed-out runs stay in the denominator. Polling adds up to approximately 100 ms of completion-detection delay.",
    "",
  ].join("\n")
}

function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function percentile(values: ReadonlyArray<number>, quantile: number) {
  if (!values.length) return 0
  return [...values].sort((left, right) => left - right)[Math.max(0, Math.ceil(values.length * quantile) - 1)]!
}
