/**
 * Every run appends one row per eval to a jsonl history. Baselines and the summary table are
 * computed from it, so a regression is a comparison with a run that actually happened.
 */
import fs from "node:fs"
import path from "node:path"
import type { Outcome, RunRecord, Mode } from "./record"
import { totalTokens } from "./record"
import type { AssertionResult } from "./assert"

export interface Row {
  readonly runId: string
  readonly time: number
  readonly eval: string
  readonly model: string
  readonly mode: Mode
  readonly hermetic: boolean
  readonly outcome: Outcome
  readonly reason?: string
  readonly passed: boolean
  readonly assertions: readonly AssertionResult[]
  readonly tokens: number
  readonly cost: number | null
  readonly durationMs: number
  readonly steps: number
  readonly toolCalls: number
  readonly guards: Readonly<Record<string, number>>
  readonly commit?: string
}

export function row(input: {
  runId: string
  record: RunRecord
  assertions: readonly AssertionResult[]
  time?: number
  commit?: string
}): Row {
  const { record } = input
  const guards: Record<string, number> = {}
  for (const event of record.guards) {
    const key = `${event.guard}:${event.action}`
    guards[key] = (guards[key] ?? 0) + 1
  }
  return {
    runId: input.runId,
    time: input.time ?? Date.now(),
    eval: record.eval,
    model: record.model,
    mode: record.mode,
    hermetic: record.hermetic,
    outcome: record.outcome,
    ...(record.reason ? { reason: record.reason } : {}),
    passed: record.outcome === "completed" && input.assertions.every((item) => item.pass),
    assertions: input.assertions,
    tokens: totalTokens(record.usage),
    cost: record.cost,
    durationMs: record.durationMs,
    steps: record.steps,
    toolCalls: record.tools.length,
    guards,
    ...(input.commit ? { commit: input.commit } : {}),
  }
}

export function append(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(value) + "\n")
}

/** Unparseable lines are skipped: a half-written row from a killed run must not hide the rest. */
export function read<T = Row>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return []
      try {
        return [JSON.parse(line) as T]
      } catch {
        return []
      }
    })
}

export type Baseline = { type: "last" } | { type: "best" } | { type: "model"; model: string }

export function parseBaseline(value: string | undefined): Baseline | undefined {
  if (!value) return undefined
  if (value === "last" || value === "best") return { type: value }
  if (value.startsWith("model:") && value.length > 6) return { type: "model", model: value.slice(6) }
  throw new Error(`--baseline must be last, best or model:<provider/model>, got ${value}`)
}

/** The row from an earlier run that `current` is compared with. Scripted and live rows never mix. */
export function baselineFor(rows: readonly Row[], current: Row, baseline: Baseline): Row | undefined {
  const model = baseline.type === "model" ? baseline.model : current.model
  const earlier = rows.filter(
    (item) =>
      item.runId !== current.runId && item.eval === current.eval && item.model === model && item.mode === current.mode,
  )
  if (baseline.type === "best") {
    const passed = earlier.filter((item) => item.passed)
    const pool = passed.length ? passed : earlier
    return [...pool].sort(
      (a, b) =>
        (a.cost ?? Number.POSITIVE_INFINITY) - (b.cost ?? Number.POSITIVE_INFINITY) ||
        a.durationMs - b.durationMs ||
        b.time - a.time,
    )[0]
  }
  return [...earlier].sort((a, b) => b.time - a.time)[0]
}

export interface Comparison {
  readonly eval: string
  readonly model: string
  readonly baseline?: Row
  /** Passed before, fails now. */
  readonly regression: boolean
  readonly fixed: boolean
  readonly costDelta?: number
  readonly durationDelta: number | undefined
}

export function compare(current: Row, base: Row | undefined): Comparison {
  return {
    eval: current.eval,
    model: current.model,
    ...(base ? { baseline: base } : {}),
    regression: !!base && base.passed && !current.passed,
    fixed: !!base && !base.passed && current.passed,
    ...(base && base.cost !== null && current.cost !== null ? { costDelta: current.cost - base.cost } : {}),
    durationDelta: base ? current.durationMs - base.durationMs : undefined,
  }
}

export interface ModelSummary {
  readonly model: string
  readonly evals: number
  readonly passed: number
  readonly passRate: number
  readonly crashed: number
  readonly unmeasured: number
  /** Sum over measured runs; null when none were measured. */
  readonly cost: number | null
  readonly tokens: number
  readonly avgDurationMs: number
}

export function summarize(rows: readonly Row[]): ModelSummary[] {
  const byModel = new Map<string, Row[]>()
  for (const item of rows) byModel.set(item.model, [...(byModel.get(item.model) ?? []), item])
  return [...byModel.entries()].map(([model, items]) => {
    const measured = items.filter((item) => item.cost !== null)
    return {
      model,
      evals: items.length,
      passed: items.filter((item) => item.passed).length,
      passRate: items.filter((item) => item.passed).length / items.length,
      crashed: items.filter((item) => item.outcome === "crashed").length,
      unmeasured: items.filter((item) => item.outcome === "unmeasured").length,
      cost: measured.length ? measured.reduce((sum, item) => sum + (item.cost ?? 0), 0) : null,
      tokens: items.reduce((sum, item) => sum + item.tokens, 0),
      avgDurationMs: Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / items.length),
    }
  })
}

export function table(headers: readonly string[], body: readonly (readonly string[])[]) {
  const widths = headers.map((header, i) => Math.max(header.length, ...body.map((cells) => (cells[i] ?? "").length)))
  const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd()
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n")
}

export function usd(value: number | null | undefined) {
  if (value === null || value === undefined) return "unmeasured"
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 0.01 ? 4 : 2)}`
}

export function formatSummary(summaries: readonly ModelSummary[]) {
  return table(
    ["model", "pass", "rate", "crashed", "unmeasured", "cost", "tokens", "avg time"],
    summaries.map((item) => [
      item.model,
      `${item.passed}/${item.evals}`,
      `${Math.round(item.passRate * 100)}%`,
      String(item.crashed),
      String(item.unmeasured),
      usd(item.cost),
      String(item.tokens),
      `${(item.avgDurationMs / 1000).toFixed(1)}s`,
    ]),
  )
}

export function formatComparisons(comparisons: readonly Comparison[]) {
  return table(
    ["eval", "model", "baseline", "change", "cost Δ", "time Δ"],
    comparisons.map((item) => [
      item.eval,
      item.model,
      item.baseline ? `${item.baseline.passed ? "pass" : "fail"} (${item.baseline.runId})` : "none",
      item.regression ? "REGRESSION" : item.fixed ? "fixed" : item.baseline ? "same" : "-",
      item.costDelta === undefined ? "-" : `${item.costDelta >= 0 ? "+" : "-"}${usd(Math.abs(item.costDelta))}`,
      item.durationDelta === undefined ? "-" : `${item.durationDelta >= 0 ? "+" : ""}${(item.durationDelta / 1000).toFixed(1)}s`,
    ]),
  )
}

export * as EvalHistory from "./history"
