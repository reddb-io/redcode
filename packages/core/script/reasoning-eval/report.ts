import { Option, Schema } from "effect"

export interface Run {
  caseID: string
  round: number
  pairID?: string
  experiment?: string
  split?: "calibration" | "held-out"
  family?: string
  taskKind?: "read-only" | "coding"
  mode: "single" | "dual" | "observe"
  outcome: string
  durationMs: number
  observationWaitMs?: number
  initial: ReturnType<typeof score>
  final: ReturnType<typeof score>
  repairs: number
  repairBaselineKnown?: boolean
  s1Tokens: number
  s2Tokens: number
  s2CostUsd: number
  s2Unpriced: boolean
  s1CostUsd?: number
  evaluatorFailures: number
  oracleMs?: number
  changes?: readonly string[]
  commands?: number
}

export interface CampaignPlan {
  pairID: string
  experiment: string
  split: "calibration" | "held-out"
  expectedRuns: number
}

export interface ReportOptions {
  suite?: "diagnostic" | "coding"
  signature?: string
  pairs?: readonly { id: string; model: string; responseModel: string; evaluator: string }[]
  plans?: readonly CampaignPlan[]
  expectedExecutions?: number
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
  return (["single", "dual", "observe"] as const).map((mode) => {
    const group = runs.filter((run) => run.mode === mode)
    const successful = group.filter((run) => run.outcome === "succeeded")
    const repaired = group.filter((run) => run.repairs > 0)
    const classified = repaired.filter((run) => run.repairBaselineKnown !== false)
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
      oracleRuns: group.filter((run) => run.oracleMs !== undefined).length,
      medianOracleMs: percentile(
        group.flatMap((run) => (run.oracleMs === undefined ? [] : [run.oracleMs])),
        0.5,
      ),
      changedFiles: group.reduce((sum, run) => sum + (run.changes?.length ?? 0), 0),
      commands: group.reduce((sum, run) => sum + (run.commands ?? 0), 0),
      s1Tokens: group.reduce((sum, run) => sum + run.s1Tokens, 0),
      s2Tokens: group.reduce((sum, run) => sum + run.s2Tokens, 0),
      s2CostUsd: group.reduce((sum, run) => sum + run.s2CostUsd, 0),
      s1CostUsd: group.reduce((sum, run) => sum + (run.s1CostUsd ?? 0), 0),
      totalCostUsd: group.reduce((sum, run) => sum + run.s2CostUsd + (run.s1CostUsd ?? 0), 0),
      costComplete:
        group.length > 0 && group.every((run) => !run.s2Unpriced && (mode === "single" || run.s1CostUsd !== undefined)),
      evaluatorFailures: group.reduce((sum, run) => sum + run.evaluatorFailures, 0),
      repaired: repaired.length,
      unknownBaseline: repaired.length - classified.length,
      improved: classified.filter((run) => !run.initial.pass && run.final.pass).length,
      unnecessary: classified.filter((run) => run.initial.pass && run.final.pass).length,
      degraded: classified.filter((run) => run.initial.pass && !run.final.pass).length,
      ineffective: classified.filter((run) => !run.initial.pass && !run.final.pass).length,
    }
  })
}

/** Improvement and the 2x monetary ceiling are acceptance criteria, not token comparisons. */
export function acceptance(input: ReadonlyArray<Run>, expectedRuns: number) {
  const runs = input.filter((run) => run.mode !== "observe")
  const [single, dual] = summarize(runs)
  const comparisons = matched(runs)
  const complete =
    runs.length === expectedRuns &&
    expectedRuns > 0 &&
    single!.runs === dual!.runs &&
    comparisons.length === single!.runs &&
    runs.every((run) => run.outcome === "succeeded")
  const costKnown = single!.costComplete && dual!.costComplete
  const ratio = !costKnown
    ? undefined
    : single!.totalCostUsd > 0
      ? dual!.totalCostUsd / single!.totalCostUsd
      : dual!.totalCostUsd === 0
        ? 1
        : undefined
  const overBudgetPairs = comparisons.flatMap(({ single, dual }) => {
    return !single.s2Unpriced &&
      !dual.s2Unpriced &&
      dual.s1CostUsd !== undefined &&
      dual.s2CostUsd + dual.s1CostUsd > 2 * single.s2CostUsd
      ? [{ ...identity(single), caseID: single.caseID, round: single.round }]
      : []
  })
  const cases = new Map<string, Run[]>()
  runs.forEach((run) => {
    const key = JSON.stringify([groupKey(run), run.caseID])
    cases.set(key, [...(cases.get(key) ?? []), run])
  })
  const regressedCases = [
    ...new Set(
      [...cases.values()].flatMap((group) => {
        const count = (mode: Run["mode"]) =>
          group.filter((run) => run.mode === mode && run.outcome === "succeeded" && run.final.pass).length
        return count("dual") < count("single") ? [group[0]!.caseID] : []
      }),
    ),
  ]
  const reasons = [
    ...(!complete ? ["incomplete_or_invalid_suite"] : []),
    ...(dual!.passed <= single!.passed ? ["no_accuracy_improvement"] : []),
    ...(regressedCases.length ? ["case_accuracy_regression"] : []),
    ...(dual!.degraded ? ["repair_degraded_correct_answer"] : []),
    ...(runs.some((run) => run.repairs > 0 && run.repairBaselineKnown === false) ? ["unknown_repair_baseline"] : []),
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
  return matched(runs).map(({ single, dual }) => ({
    ...identity(single),
    caseID: single.caseID,
    round: single.round,
    ...(single.family === undefined ? {} : { family: single.family }),
    ...(single.taskKind === undefined ? {} : { taskKind: single.taskKind }),
    singlePassed: single.outcome === "succeeded" && single.final.pass,
    dualPassed: dual.outcome === "succeeded" && dual.final.pass,
    durationDeltaMs: dual.durationMs - single.durationMs,
    tokenDelta: dual.s1Tokens + dual.s2Tokens - single.s2Tokens,
  }))
}

/** Every planned pair, experiment and split must independently clear the monetary and accuracy gates. */
export function campaign(runs: ReadonlyArray<Run>, plans: readonly CampaignPlan[], expectedExecutions?: number) {
  const groups = plans.map((plan) => {
    const group = runs.filter((run) => groupKey(run) === groupKey(plan))
    return {
      pairID: plan.pairID,
      experiment: plan.experiment,
      split: plan.split,
      summary: summarize(group),
      acceptance: acceptance(group, plan.expectedRuns),
    }
  })
  const planned = new Set(plans.map(groupKey))
  const complete =
    plans.length > 0 &&
    planned.size === plans.length &&
    runs.every((run) => planned.has(groupKey(run))) &&
    groups.every((group) => !group.acceptance.reasons.includes("incomplete_or_invalid_suite")) &&
    (expectedExecutions === undefined ||
      (Number.isInteger(expectedExecutions) &&
        expectedExecutions > 0 &&
        runs.length === expectedExecutions &&
        new Set(runs.map((run) => JSON.stringify([groupKey(run), run.caseID, run.round, run.mode]))).size ===
          runs.length &&
        runs.every((run) => run.outcome === "succeeded")))
  return {
    groups,
    complete,
    passed: complete && groups.every((group) => group.acceptance.passed),
  }
}

export function markdown(
  runs: ReadonlyArray<Run>,
  model: string,
  evaluator: string,
  expectedRuns = runs.length,
  options: ReportOptions = {},
) {
  const summary = summarize(runs)
  const gate = acceptance(runs, expectedRuns)
  const grouped = options.plans === undefined ? undefined : campaign(runs, options.plans, options.expectedExecutions)
  const coding = options.suite === "coding" || runs.some((run) => run.taskKind === "coding")
  return [
    "# Single versus dual reasoning",
    "",
    ...(options.pairs?.length
      ? [
          "| Model pair | S2 selection | Actual S2 model | S1 |",
          "| --- | --- | --- | --- |",
          ...options.pairs.map((pair) => `| ${pair.id} | ${pair.model} | ${pair.responseModel} | ${pair.evaluator} |`),
        ]
      : [`S2: \`${model}\`. S1: \`${evaluator}\`.`]),
    ...(options.signature ? [`Fixture signature: \`${options.signature}\`.`] : []),
    "Fresh sessions, identical task fixtures and S2 selection within each model pair, alternating single/dual order. Grades are independent of S1 verdicts.",
    coding
      ? "Coding fixtures record file changes, verification command counts and oracle duration separately. Read-only fixtures use exact deterministic facts."
      : "Read-only fixtures use exact deterministic facts.",
    "",
    ...(grouped
      ? [
          "Aggregate figures below are descriptive; acceptance is evaluated independently for every planned model pair, experiment and split.",
          "",
        ]
      : []),
    "| Mode | Passes | Mean score | Median ms | P95 ms | S2 tokens | S1 tokens | Total USD | Repairs | Improved | Unnecessary | Degraded | Unknown baseline |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.map(
      (group) =>
        `| ${group.mode} | ${group.passed}/${group.runs} | ${group.meanScore.toFixed(3)} | ${Math.round(group.medianDurationMs)} | ${Math.round(group.p95DurationMs)} | ${group.s2Tokens} | ${group.s1Tokens} | ${group.totalCostUsd.toFixed(6)}${group.costComplete ? "" : " (incomplete)"} | ${group.repaired} | ${group.improved} | ${group.unnecessary} | ${group.degraded} | ${group.unknownBaseline} |`,
    ),
    "",
    ...(grouped
      ? [
          "| Model pair | Experiment | Split | Mode | Passes | Mean score | Median ms | P95 ms | Total USD | Oracle runs | Oracle median ms | Changed files | Commands |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...grouped.groups.flatMap((group) =>
            group.summary.map(
              (mode) =>
                `| ${group.pairID} | ${group.experiment} | ${group.split} | ${mode.mode} | ${mode.passed}/${mode.runs} | ${mode.meanScore.toFixed(3)} | ${Math.round(mode.medianDurationMs)} | ${Math.round(mode.p95DurationMs)} | ${mode.totalCostUsd.toFixed(6)}${mode.costComplete ? "" : " (incomplete)"} | ${mode.oracleRuns} | ${mode.oracleRuns ? Math.round(mode.medianOracleMs) : "unavailable"} | ${mode.changedFiles} | ${mode.commands} |`,
            ),
          ),
          "",
        ]
      : []),
    "| Model pair | Experiment | Split | Task kind | Family | Case | Round | Single pass | Dual pass | Dual latency delta ms | Dual token delta |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...pairs(runs).map(
      (pair) =>
        `| ${pair.pairID ?? "legacy"} | ${pair.experiment ?? "legacy"} | ${pair.split ?? "legacy"} | ${pair.taskKind ?? "read-only"} | ${pair.family ?? "unavailable"} | ${pair.caseID} | ${pair.round} | ${pair.singlePassed} | ${pair.dualPassed} | ${Math.round(pair.durationDeltaMs)} | ${pair.tokenDelta} |`,
    ),
    "",
    ...(grouped
      ? [
          "| Model pair | Experiment | Split | Acceptance | Cost ratio | Reasons |",
          "| --- | --- | --- | --- | --- | --- |",
          ...grouped.groups.map(
            (group) =>
              `| ${group.pairID} | ${group.experiment} | ${group.split} | ${group.acceptance.passed ? "passed" : "failed"} | ${group.acceptance.costRatio === null ? "unknown" : group.acceptance.costRatio.toFixed(3) + "x"} | ${group.acceptance.reasons.join(", ") || "none"} |`,
          ),
          "",
          `Campaign acceptance: **${grouped.passed ? "passed" : "failed"}**. Every planned group must improve accuracy with no case-level regression or degraded repair and known total cost at most 2x single. Empty groups, missing or duplicate single/dual runs, duplicate plans and unplanned groups fail. Observation accuracy and costs do not enter the single/dual gate.`,
          ...(options.expectedExecutions === undefined
            ? []
            : [
                `Execution collection: **${grouped.complete ? "complete" : "incomplete or invalid"}** (${runs.length}/${options.expectedExecutions}). Every requested execution, including observation, must finish successfully and have a unique identity.`,
              ]),
        ]
      : [
          `Acceptance: **${gate.passed ? "passed" : "failed"}**. Requires more dual passes, no case-level accuracy regression, no degraded repair, and known total cost at most 2x single. Cost ratio: ${gate.costRatio === null ? "unknown" : gate.costRatio.toFixed(3) + "x"}. Reasons: ${gate.reasons.join(", ") || "none"}.`,
        ]),
    "",
    coding
      ? "These are fixture-based coding diagnostics, not proof of production coding effectiveness. Calibration and held-out results remain separate; calibration results do not certify held-out improvement."
      : "This is a small diagnostic sample of read-only tasks, not proof of production coding effectiveness.",
    ...(coding
      ? [
          "A repair whose first-candidate filesystem baseline was not captured remains in repair counts, is excluded from improved/unnecessary/degraded/ineffective classifications, and fails acceptance with unknown_repair_baseline. The original buggy fixture is not a measured first candidate.",
        ]
      : []),
    "Costs use reported upstream charges when available and explicitly supplied price estimates otherwise; they are not a billing invoice. Missing prices remain unknown and fail the cost gate. Failed and timed-out runs stay in the denominator. Polling adds up to approximately 100 ms of completion-detection delay.",
    "",
  ].join("\n")
}

function identity(run: Run) {
  return {
    ...(run.pairID === undefined ? {} : { pairID: run.pairID }),
    ...(run.experiment === undefined ? {} : { experiment: run.experiment }),
    ...(run.split === undefined ? {} : { split: run.split }),
  }
}

function groupKey(input: Pick<Run, "pairID" | "experiment" | "split">) {
  return JSON.stringify([input.pairID ?? "legacy", input.experiment ?? "legacy", input.split ?? "legacy"])
}

function matched(runs: ReadonlyArray<Run>) {
  const groups = new Map<string, Run[]>()
  runs
    .filter((run) => run.mode !== "observe")
    .forEach((run) => {
      const key = JSON.stringify([groupKey(run), run.caseID, run.round])
      groups.set(key, [...(groups.get(key) ?? []), run])
    })
  return [...groups.values()].flatMap((group) => {
    const single = group.filter((run) => run.mode === "single")
    const dual = group.filter((run) => run.mode === "dual")
    return single.length === 1 && dual.length === 1 ? [{ single: single[0]!, dual: dual[0]! }] : []
  })
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
