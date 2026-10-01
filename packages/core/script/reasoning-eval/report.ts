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
      costComplete: mode === "single" && group.every((run) => !run.s2Unpriced),
      evaluatorFailures: group.reduce((sum, run) => sum + run.evaluatorFailures, 0),
      repaired: repaired.length,
      improved: repaired.filter((run) => !run.initial.pass && run.final.pass).length,
      unnecessary: repaired.filter((run) => run.initial.pass && run.final.pass).length,
      degraded: repaired.filter((run) => run.initial.pass && !run.final.pass).length,
      ineffective: repaired.filter((run) => !run.initial.pass && !run.final.pass).length,
    }
  })
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

export function markdown(runs: ReadonlyArray<Run>, model: string, evaluator: string) {
  const summary = summarize(runs)
  return [
    "# Single versus dual reasoning",
    "",
    `S2: \`${model}\`. S1: \`${evaluator}\`.`,
    "Fresh sessions, identical task fixtures and S2 selection, alternating pair order. Grades use deterministic fixture facts, independently of S1 verdicts.",
    "",
    "| Mode | Passes | Mean score | Median ms | P95 ms | S2 tokens | S1 tokens | Reported S2 USD | Repairs | Improved | Unnecessary | Degraded |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.map(
      (group) =>
        `| ${group.mode} | ${group.passed}/${group.runs} | ${group.meanScore.toFixed(3)} | ${Math.round(group.medianDurationMs)} | ${Math.round(group.p95DurationMs)} | ${group.s2Tokens} | ${group.s1Tokens} | ${group.s2CostUsd.toFixed(6)}${group.costComplete ? "" : " (incomplete)"} | ${group.repaired} | ${group.improved} | ${group.unnecessary} | ${group.degraded} |`,
    ),
    "",
    "| Case | Round | Single pass | Dual pass | Dual latency delta ms | Dual token delta |",
    "| --- | --- | --- | --- | --- | --- |",
    ...pairs(runs).map(
      (pair) =>
        `| ${pair.caseID} | ${pair.round} | ${pair.singlePassed} | ${pair.dualPassed} | ${Math.round(pair.durationDeltaMs)} | ${pair.tokenDelta} |`,
    ),
    "",
    "This is a small diagnostic sample of read-only coding and workflow tasks, not a production coding benchmark or a statistically established quality gain. Unnecessary repairs mean the original and final answers both passed this suite's oracle; the oracle does not cover every aspect of writing quality. Failed or timed-out executions remain in the denominator. S1 prices are unavailable, so reported USD is not the total dual-mode cost. Polling adds up to approximately 100 ms of completion-detection delay.",
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
