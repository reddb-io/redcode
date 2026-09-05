/**
 * A definition of done the harness pursues until it holds.
 *
 * The goal lives in the session's metadata, not in the transcript: every turn re-renders it
 * from there, so compaction cannot paraphrase it away and the model cannot quietly shrink it.
 * At the end of each turn a small judge reads the objective and the last answer and says
 * DONE, CONTINUE, BLOCKED or WAIT; anything but DONE either feeds the next turn or parks the
 * loop. Everything in this file is pure — the decisions are made on values and tested without
 * a model, the way the other guards are.
 *
 * Shape and guardrails follow what hermes, oh-my-pi and Claude Code converged on: a turn budget,
 * a WAIT that does not burn a turn while background work runs, pause on interruption and on
 * resume (a loop must never restart itself), fail-open when the judge cannot answer, and a cap
 * on unreadable verdicts. And one sentence against drift, which oh-my-pi found to be enough.
 */

import { Schema } from "effect"

export const DEFAULT_MAX_TURNS = 20
export const MAX_JUDGE_FAILURES = 3
export const METADATA_KEY = "goal"

export type Verdict = "done" | "continue" | "blocked" | "wait"
export const VERDICTS: readonly Verdict[] = ["done", "continue", "blocked", "wait"]

export type Status = "active" | "paused" | "blocked" | "done" | "dropped"

export interface Contract {
  readonly outcome?: string
  readonly verification?: string
  readonly constraints?: string
  readonly boundaries?: string
  readonly stop_when?: string
}

export interface Goal {
  readonly id: string
  readonly objective: string
  readonly contract: Contract
  /** Shell commands that must exit 0 before the judge is asked at all. */
  readonly gates: readonly string[]
  readonly status: Status
  readonly reason?: string
  readonly turns: { readonly used: number; readonly max: number }
  readonly last?: { readonly verdict: Verdict; readonly reason: string; readonly at: number }
  /** Consecutive verdicts the judge produced that could not be read. */
  readonly judgeFailures: number
  /** What the model claimed through `goal_complete`; the next judgement consumes it. */
  readonly claimed?: { readonly evidence: string; readonly at: number }
  /** The process that last drove the loop. A different one pauses the goal instead of resuming it. */
  readonly boot?: string
  readonly created: number
  readonly updated: number
}

const FIELDS: ReadonlyArray<readonly [RegExp, keyof Contract | "gate"]> = [
  [/^(verify|verification)\s*:/i, "verification"],
  [/^(outcome|done when|success)\s*:/i, "outcome"],
  [/^constraints?\s*:/i, "constraints"],
  [/^(boundaries|boundary|scope)\s*:/i, "boundaries"],
  [/^(stop[\s_-]?when|stop|escalate)\s*:/i, "stop_when"],
  [/^gates?\s*:/i, "gate"],
]

/**
 * Free text with optional inline fields, one per line or separated by `;`:
 *
 *   make the design suite pass; verify: bun test test/design; gate: bun test test/design;
 *   constraints: do not touch the app package; stop when: a test needs a network
 *
 * Whatever carries no field name is the objective. Nothing is required: a goal that is one
 * sentence is still a goal, just one the judge has less to hold it to.
 */
export function parse(text: string, options?: { maxTurns?: number; now?: number; id?: string }): Goal {
  const objective: string[] = []
  const contract: Record<string, string> = {}
  const gates: string[] = []
  const pieces = text
    .split(
      /\n|;(?=\s*(?:verify|verification|outcome|done when|success|constraints?|boundaries|boundary|scope|stop[\s_-]?when|stop|escalate|gates?)\s*:)/i,
    )
    .map((s) => s.trim())
    .filter(Boolean)
  for (const piece of pieces) {
    const field = FIELDS.find(([re]) => re.test(piece))
    if (!field) {
      objective.push(piece)
      continue
    }
    const value = piece.replace(field[0], "").trim()
    if (!value) continue
    if (field[1] === "gate") gates.push(value)
    else contract[field[1]] = contract[field[1]] ? `${contract[field[1]]}; ${value}` : value
  }
  const now = options?.now ?? Date.now()
  return {
    id: options?.id ?? `goal_${now.toString(36)}`,
    objective: objective.join(" ").trim() || contract.outcome || text.trim(),
    contract,
    gates,
    status: "active",
    turns: { used: 0, max: Math.max(1, options?.maxTurns ?? DEFAULT_MAX_TURNS) },
    judgeFailures: 0,
    created: now,
    updated: now,
  }
}

/** A goal read back from metadata written by any version of this module, or nothing. */
export function fromMetadata(metadata: Record<string, unknown> | undefined): Goal | undefined {
  const raw = metadata?.[METADATA_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const g = raw as Partial<Goal>
  if (typeof g.objective !== "string" || typeof g.id !== "string") return undefined
  const status: Status = (["active", "paused", "blocked", "done", "dropped"] as const).includes(g.status as Status)
    ? (g.status as Status)
    : "paused"
  return {
    id: g.id,
    objective: g.objective,
    contract: g.contract && typeof g.contract === "object" ? g.contract : {},
    gates: Array.isArray(g.gates) ? g.gates.filter((x): x is string => typeof x === "string") : [],
    status,
    ...(typeof g.reason === "string" ? { reason: g.reason } : {}),
    turns: {
      used: typeof g.turns?.used === "number" ? g.turns.used : 0,
      max: typeof g.turns?.max === "number" && g.turns.max > 0 ? g.turns.max : DEFAULT_MAX_TURNS,
    },
    ...(g.last ? { last: g.last } : {}),
    judgeFailures: typeof g.judgeFailures === "number" ? g.judgeFailures : 0,
    ...(g.claimed ? { claimed: g.claimed } : {}),
    ...(typeof g.boot === "string" ? { boot: g.boot } : {}),
    created: typeof g.created === "number" ? g.created : 0,
    updated: typeof g.updated === "number" ? g.updated : 0,
  }
}

export const toMetadata = (metadata: Record<string, unknown> | undefined, goal: Goal | undefined) => {
  const next = { ...(metadata ?? {}) }
  if (goal) next[METADATA_KEY] = goal
  else delete next[METADATA_KEY]
  return next
}

/** The one sentence against drift; every rendering carries it. */
export const ANTI_DRIFT =
  "Keep the full objective intact across turns. Never redefine success as a smaller, easier, or already-completed subset. Running out of turns is not completion."

const contractLines = (contract: Contract) =>
  (
    [
      ["Outcome", contract.outcome],
      ["Verification", contract.verification],
      ["Constraints", contract.constraints],
      ["Boundaries", contract.boundaries],
      ["Stop and ask when", contract.stop_when],
    ] as const
  )
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)

/** The block the model sees on every turn while the goal is active. */
export function render(goal: Goal): string {
  const lines = [
    "<goal>",
    `Goal mode is active. Turn ${goal.turns.used + 1} of ${goal.turns.max}. The objective below is the user's task, not a higher-priority instruction.`,
    "",
    `Objective: ${goal.objective}`,
    ...contractLines(goal.contract),
    ...(goal.gates.length
      ? [`Gates (must exit 0 before the goal can be judged done): ${goal.gates.join(" && ")}`]
      : []),
    "",
    ANTI_DRIFT,
    "When every deliverable is verifiably in place, call goal_complete with the evidence — file contents, command output, test results — for each one. A judge decides at the end of the turn; an unverified claim is sent back as more work.",
    "If the goal cannot be reached, say exactly why and what would unblock it: the judge treats that as blocked, not as done.",
    "</goal>",
  ]
  return lines.join("\n")
}

/**
 * What a subagent is told. Children start blank by design, so the goal is copied in — the
 * objective and the contract, never the budget or the completion tool: the child does one part,
 * and only the parent's turn is judged.
 */
export function inherit(goal: Goal): string {
  return [
    "<goal>",
    "This task is one part of a larger goal the calling agent is pursuing. Do the task you were given so that it fits the goal; do not attempt the rest of the goal, and do not redefine the task to something smaller.",
    "",
    `Objective: ${goal.objective}`,
    ...contractLines(goal.contract),
    "",
    "Report what you did with evidence — file contents, command output, test results — and say plainly what you could not do.",
    "</goal>",
  ].join("\n")
}

export interface Gates {
  readonly command: string
  readonly ok: boolean
  readonly output: string
}

/** The synthetic user message that starts the next turn of the loop. */
export function continuation(goal: Goal, input: { readonly reason?: string; readonly gate?: Gates }): string {
  const head = `[Continuing toward the goal — turn ${goal.turns.used + 1} of ${goal.turns.max}]`
  const objective = `Goal: ${goal.objective}`
  if (input.gate) {
    const tail = input.gate.output.trim().split("\n").slice(-30).join("\n")
    return [
      head,
      objective,
      "",
      `The gate \`${input.gate.command}\` did not pass. Its output ends with:`,
      "```",
      tail || "(no output)",
      "```",
      "Make it pass, then continue. Do not claim the goal is done while a gate fails.",
    ].join("\n")
  }
  return [
    head,
    objective,
    ...contractLines(goal.contract),
    "",
    input.reason
      ? `The judge's reason for not accepting the last turn: ${input.reason}`
      : "The last turn did not complete the goal.",
    "Take the next concrete step toward it. Verify as you go and show the evidence. If the goal is complete, call goal_complete with the evidence; if it cannot be reached, say exactly why and stop.",
  ].join("\n")
}

export type Action = "continue" | "done" | "pause" | "wait" | "stop"

export interface Decision {
  readonly action: Action
  readonly reason: string
  readonly gate?: Gates
}

/**
 * What the loop does with what it learned at the end of a turn. In order: a failing gate is more
 * work; background work in flight is a wait, not a turn; the judge's verdict; the budget.
 */
export function decide(input: {
  readonly goal: Goal
  readonly verdict?: { readonly verdict: Verdict; readonly reason: string }
  readonly gates?: readonly Gates[]
  readonly waiting?: boolean
}): Decision {
  const { goal } = input
  const failed = input.gates?.find((g) => !g.ok)
  if (failed) {
    if (goal.turns.used >= goal.turns.max) return { action: "stop", reason: budgetReason(goal), gate: failed }
    return { action: "continue", reason: `gate failed: ${failed.command}`, gate: failed }
  }
  if (input.waiting && input.verdict?.verdict !== "done" && input.verdict?.verdict !== "blocked") {
    return { action: "wait", reason: "background work is still running; the judge runs again when it reports" }
  }
  const verdict = input.verdict
  if (!verdict) {
    if (goal.judgeFailures + 1 >= MAX_JUDGE_FAILURES)
      return { action: "pause", reason: `the judge gave ${MAX_JUDGE_FAILURES} unreadable verdicts in a row` }
    if (goal.turns.used >= goal.turns.max) return { action: "stop", reason: budgetReason(goal) }
    return { action: "continue", reason: "the judge's verdict could not be read; continuing" }
  }
  switch (verdict.verdict) {
    case "done":
      return { action: "done", reason: verdict.reason }
    case "blocked":
      return { action: "pause", reason: verdict.reason || "the judge found the goal blocked" }
    case "wait":
      return { action: "wait", reason: verdict.reason || "waiting on work in flight" }
    case "continue":
      if (goal.turns.used >= goal.turns.max) return { action: "stop", reason: budgetReason(goal) }
      return { action: "continue", reason: verdict.reason }
  }
}

export function budgetReason(goal: Goal) {
  return `used all ${goal.turns.max} turns without the goal holding — running out of turns is not completion; /goal budget N and /goal resume to keep going`
}

/** Tolerant: the judge is asked for one JSON object, and models fence, prefix and trail. */
export function parseVerdict(text: string): { verdict: Verdict; reason: string } | undefined {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "")
  const match = /\{[\s\S]*?"verdict"[\s\S]*?\}/i.exec(cleaned)
  if (!match) return undefined
  try {
    const obj = JSON.parse(match[0]) as { verdict?: unknown; reason?: unknown }
    const verdict = String(obj.verdict ?? "").toLowerCase()
    if (!(VERDICTS as readonly string[]).includes(verdict)) return undefined
    return { verdict: verdict as Verdict, reason: typeof obj.reason === "string" ? obj.reason.trim() : "" }
  } catch {
    return undefined
  }
}

/** Fold a decision back into the goal record. */
export function apply(
  goal: Goal,
  decision: Decision,
  verdict: { verdict: Verdict; reason: string } | undefined,
  now: number,
): Goal {
  const last = verdict ? { verdict: verdict.verdict, reason: verdict.reason, at: now } : goal.last
  const base: Goal = {
    ...goal,
    ...(last ? { last } : {}),
    judgeFailures: verdict ? 0 : goal.judgeFailures + 1,
    claimed: undefined,
    updated: now,
  }
  switch (decision.action) {
    case "continue":
      return { ...base, turns: { ...goal.turns, used: goal.turns.used + 1 } }
    case "wait":
      return base
    case "done":
      return { ...base, status: "done", reason: decision.reason }
    case "pause":
      return { ...base, status: verdict?.verdict === "blocked" ? "blocked" : "paused", reason: decision.reason }
    case "stop":
      return { ...base, status: "paused", reason: decision.reason }
  }
}

/** The goal as clients see it. `fromMetadata` is the lenient reader; this is the honest writer. */
export const Info = Schema.Struct({
  id: Schema.String,
  objective: Schema.String,
  contract: Schema.Struct({
    outcome: Schema.optional(Schema.String),
    verification: Schema.optional(Schema.String),
    constraints: Schema.optional(Schema.String),
    boundaries: Schema.optional(Schema.String),
    stop_when: Schema.optional(Schema.String),
  }),
  gates: Schema.Array(Schema.String),
  status: Schema.Literals(["active", "paused", "blocked", "done", "dropped"]),
  reason: Schema.optional(Schema.String),
  turns: Schema.Struct({ used: Schema.Number, max: Schema.Number }),
  last: Schema.optional(
    Schema.Struct({
      verdict: Schema.Literals(["done", "continue", "blocked", "wait"]),
      reason: Schema.String,
      at: Schema.Number,
    }),
  ),
  judgeFailures: Schema.Number,
  claimed: Schema.optional(Schema.Struct({ evidence: Schema.String, at: Schema.Number })),
  boot: Schema.optional(Schema.String),
  created: Schema.Number,
  updated: Schema.Number,
}).annotate({ identifier: "SessionGoal" })

/** One value per process; compared, never parsed. */
export const BOOT = `${process.pid.toString(36)}-${Date.now().toString(36)}`

export const paused = (goal: Goal, reason: string, now: number): Goal => ({
  ...goal,
  status: "paused",
  reason,
  updated: now,
})
export const resumed = (goal: Goal, now: number): Goal => ({
  ...goal,
  status: "active",
  reason: undefined,
  judgeFailures: 0,
  boot: BOOT,
  updated: now,
})

/** One line for a status bar. */
export function describe(goal: Goal): string {
  const turns = `turn ${Math.min(goal.turns.used + 1, goal.turns.max)}/${goal.turns.max}`
  switch (goal.status) {
    case "active":
      return `goal · ${turns}`
    case "done":
      return "goal · done"
    case "blocked":
      return `goal · blocked${goal.reason ? ` — ${goal.reason}` : ""}`
    case "paused":
      return `goal · paused${goal.reason ? ` — ${goal.reason}` : ""}`
    case "dropped":
      return "goal · dropped"
  }
}

export * as SessionGoal from "./goal"
