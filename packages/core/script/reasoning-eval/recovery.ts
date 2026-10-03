import { Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { IntelligenceCodeRepair } from "../../src/intelligence/code-repair"
import { IntelligenceEvaluation } from "../../src/intelligence/evaluation"
import { candidates } from "./detector"
import { Corpus, codingCorpus } from "./corpus"
import type { Verification, snapshot } from "./coding"

export const ARMS = ["s2-review", "s1-generic", "s1-requirements"] as const
export type Arm = (typeof ARMS)[number]
export const POLICY = {
  rubric: "fixed-candidate-recovery-v1",
  threshold: Intelligence.REPAIR_CONFIDENCE,
  steps: IntelligenceCodeRepair.MAX_STEPS,
  maxTokens: IntelligenceCodeRepair.MAX_TOKENS,
  timeoutMs: 300_000,
  artifact: "bounded-complete-source",
  telemetry: "no-new-collection",
} as const

export function plan(input: { corpus?: string; split?: string; rounds?: string }) {
  const corpus = Schema.decodeUnknownSync(Corpus)(input.corpus ?? "challenge")
  const split = Schema.decodeUnknownSync(Schema.Literals(["calibration", "held-out"]))(input.split ?? "calibration")
  const rounds = Number(input.rounds ?? "1")
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("Rounds must be between 1 and 10")
  const selected = candidates(codingCorpus(corpus)).filter((item) => item.split === split)
  return {
    corpus,
    split,
    rounds,
    selected,
    expectedRuns: selected.length * ARMS.length * rounds,
    signature: IntelligenceEvaluation.fingerprint(
      selected.map((item) => ({ request: item.request, label: item.expectedDefect, oracle: item.fixture.oracle })),
    ),
  }
}

/** Only public request text supplies requirement questions, never oracle names or labels. */
export function requirements(request: string) {
  return request
    .split("\n\n")[0]!
    .split(/(?<=[.!?])\s+/)
    .filter((text) => text.trim().length > 0)
    .map((text, index) => ({ id: `requirement_${index + 1}`, text }))
}

export function questions(arm: Exclude<Arm, "s2-review">, request: string) {
  if (arm === "s1-generic") return IntelligenceCodeRepair.QUESTIONS
  return IntelligenceEvaluation.questions(
    Object.fromEntries(
      requirements(request).map((item) => [
        item.id,
        `Does the actual implementation in sources.artifact violate this explicit requirement: ${JSON.stringify(item.text)}? Trace a concrete execution path. Missing tests or truncated evidence alone do not establish a defect. Do not invent requirements.`,
      ]),
    ),
  )
}

export function guidance(arm: Arm, request: string, issues: readonly string[]) {
  if (arm === "s2-review")
    return "Independently review the candidate against the original contract. No defect has been established."
  if (arm === "s1-generic") return `S1 suspects ${issues.join(", ")}. This is a hypothesis, not proof of a defect.`
  return [
    "S1 suspects violations of these original requirements. These are hypotheses, not proof of defects:",
    ...requirements(request)
      .filter((item) => issues.includes(item.id))
      .map((item) => `${item.id}: ${item.text}`),
  ].join("\n")
}

export function prompt(input: { request: string; guidance: string; editable: readonly string[] }) {
  return [
    input.request.split("\n\n")[0],
    input.guidance,
    `Review the existing implementation. Only these files may change: ${input.editable.join(", ")}.`,
    "Find a concrete counterexample before editing. If the implementation satisfies the contract, preserve it unchanged. Otherwise make a focused correction and run bun run test in the foreground after the last edit. Do not change tests, metadata or other files, add files, install dependencies, use the network, delegate, or start background work.",
    `At most ${POLICY.steps} logical model Steps are available, with ${POLICY.maxTokens} output tokens each. Step ${POLICY.steps} has no tools. Give a concise final answer with actual edits, checks and any unresolved behavior.`,
  ].join("\n\n")
}

/** Correct controls may remain unchanged. Defect recovery requires an edit and a fresh test. */
export function grade(input: {
  expectedDefect: boolean
  editable: readonly string[]
  before: Awaited<ReturnType<typeof snapshot>>
  after: Awaited<ReturnType<typeof snapshot>>
  oracle: Verification
  freshTest: boolean
}) {
  const changes = [...new Set([...Object.keys(input.before), ...Object.keys(input.after)])]
    .filter((file) => input.before[file] !== input.after[file])
    .toSorted()
  const failed = [
    ...input.oracle.failed,
    ...changes.filter((file) => !input.editable.includes(file)).map((file) => `out_of_scope:${file}`),
    ...(input.expectedDefect && !changes.some((file) => input.editable.includes(file)) ? ["no_repair"] : []),
    ...((input.expectedDefect || changes.length > 0) && !input.freshTest ? ["no_fresh_test"] : []),
  ]
  return { pass: input.oracle.pass && failed.length === 0, failed, changes }
}

export type Run = {
  candidateID: string
  round: number
  arm: Arm
  expectedDefect: boolean
  valid: boolean
  passed: boolean
  changed: boolean
  admitted: boolean
  durationMs: number
  s1CostUsd?: number
  s2CostUsd?: number
}

export function report(rows: readonly Run[], expectedRuns: number) {
  const valid = (row: Run) => row.valid && row.passed
  const totalCost = (row: Run) =>
    row.s1CostUsd !== undefined && row.s2CostUsd !== undefined ? row.s1CostUsd + row.s2CostUsd : undefined
  const key = (row: Run) => JSON.stringify([row.candidateID, row.round])
  const complete =
    rows.length === expectedRuns &&
    expectedRuns > 0 &&
    ARMS.every((arm) => {
      const group = rows.filter((row) => row.arm === arm)
      return group.length === expectedRuns / ARMS.length && new Set(group.map(key)).size === group.length
    })
  const summaries = ARMS.map((arm) => {
    const group = rows.filter((row) => row.arm === arm)
    return {
      arm,
      runs: group.length,
      invalid: group.filter((row) => !row.valid).length,
      recovered: group.filter((row) => row.expectedDefect && valid(row)).length,
      missed: group.filter((row) => row.expectedDefect && !valid(row)).length,
      preserved: group.filter((row) => !row.expectedDefect && valid(row)).length,
      degraded: group.filter((row) => !row.expectedDefect && !valid(row)).length,
      falseAlarms: arm === "s2-review" ? null : group.filter((row) => !row.expectedDefect && row.admitted).length,
      unnecessaryChanges: group.filter((row) => !row.expectedDefect && row.changed).length,
      knownCostUsd: group.reduce((sum, row) => sum + (row.s1CostUsd ?? 0) + (row.s2CostUsd ?? 0), 0),
      costComplete: group.length > 0 && group.every((row) => totalCost(row) !== undefined),
      durationMs: group.reduce((sum, row) => sum + row.durationMs, 0),
    }
  })
  const control = rows.filter((row) => row.arm === "s2-review")
  const acceptance = ARMS.filter((arm) => arm !== "s2-review").map((arm) => {
    const group = rows.filter((row) => row.arm === arm)
    const matched = group.map((row) => ({ row, control: control.find((candidate) => key(candidate) === key(row)) }))
    const costKnown =
      [...control, ...group].length > 0 && [...control, ...group].every((row) => totalCost(row) !== undefined)
    const controlCost = control.reduce((sum, row) => sum + (totalCost(row) ?? 0), 0)
    const dualCost = group.reduce((sum, row) => sum + (totalCost(row) ?? 0), 0)
    const ratio = costKnown ? (controlCost > 0 ? dualCost / controlCost : dualCost === 0 ? 1 : null) : null
    const recovered = (runs: readonly Run[]) => runs.filter((row) => row.expectedDefect && valid(row)).length
    const reasons = [
      ...(!complete || matched.some((pair) => !pair.control) ? ["incomplete_comparison"] : []),
      ...([...control, ...group].some((row) => !row.valid) ? ["invalid_execution"] : []),
      ...(recovered(group) <= recovered(control) ? ["no_recovery_improvement"] : []),
      ...(group.some((row) => !row.expectedDefect && !valid(row)) ? ["correct_candidate_degraded"] : []),
      ...(matched.some((pair) => pair.control && valid(pair.control) && !valid(pair.row)) ? ["paired_regression"] : []),
      ...(!costKnown
        ? ["unknown_total_cost"]
        : ratio === null ||
            ratio > 2 ||
            matched.some((pair) => pair.control && totalCost(pair.row)! > 2 * totalCost(pair.control)!)
          ? ["cost_above_2x"]
          : []),
    ]
    return { arm, passed: reasons.length === 0, reasons, costRatio: ratio }
  })
  return { complete, summaries, acceptance }
}
