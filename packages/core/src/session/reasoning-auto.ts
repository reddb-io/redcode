export * as ReasoningAuto from "./reasoning-auto"

import type { Router } from "@reddb-io/redcode-schema/router"
import type { LoopGuard } from "./loop-guard"
import { LOOP_GUARD_REFUSAL } from "./loop-marker"

/**
 * Reasoning effort that follows the work, for people who choose the `auto` variant.
 *
 * `auto` is never sent to a provider: every request carries one of the model's own variants, chosen
 * here from what System One made of the turn (when it runs), the size of the context and how the
 * turn is going. Whoever pays for the decision decides: a Redcode with System One decides itself and
 * tells a RedRouter to keep out; a Redcode without it lets a RedRouter whose reasoning autopilot
 * accepts `auto` decide, and otherwise decides from deterministic signals alone.
 *
 * The level moves only where a person speaks, and not again for two of their turns, because changing
 * thinking mid-loop invalidates the provider's cached prefix. The one exception is a single step up per
 * turn when the tool loop is visibly in trouble.
 */

/** The variant a person picks to let the effort follow the work. Never sent to a provider. */
export const AUTO = "auto"

/** Effort levels, least thought first. RedRouter's reasoning autopilot moves on the same ladder. */
export const LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type Level = (typeof LADDER)[number]

/** How the latest user message judged the agent's previous turn. */
export const FEEDBACK = ["agrees", "corrects", "rejects", "neutral"] as const
export type Feedback = (typeof FEEDBACK)[number]

/** User turns a level holds before it may move again, unless trouble raises it. */
export const DWELL_TURNS = 2
/** One step more when the request fills more than this share of the model's context window. */
export const CONTEXT_FRACTION = 0.5
/** Frustration (0..1) at which the next turn gets one step more. */
export const FRUSTRATION_STEP_UP = 2 / 3
/** Tool failures in a row, within one user turn, that count as trouble. */
export const FAILURE_STREAK = 2
/** Rough tokens one advertised tool definition costs, for callers whose count leaves tools out. */
export const TOOL_TOKENS = 250

// "none" turns thinking off and "max" is priced like it: reachable only when configured as a bound.
const FLOOR: Level = "minimal"
const CEILING: Level = "xhigh"

// Needs-reasoning (0..1) upper bounds, the same bands RedRouter maps deliberation onto.
const BANDS: ReadonlyArray<readonly [number, Level]> = [
  [0.15, "minimal"],
  [0.35, "low"],
  [0.6, "medium"],
  [0.8, "high"],
]

// Causes that raise the level at once, without waiting out the dwell.
const URGENT = new Set(["feedback", "frustration", "plan_mode", "explicit_think"])

export type Decider = "redcode" | "router"

export interface Assessment {
  /** System One's scores scaled to 0..1; an unresolved answer is left out. */
  readonly complexity?: number
  readonly consequence?: number
  readonly impact?: number
  /** Probability that the agent must ask before it can make progress. */
  readonly mustClarify?: number
  readonly frustration?: number
  readonly feedback?: Feedback
}

export interface Progress {
  /** The loop guard corrected or stopped a repeated call in this user turn. */
  readonly loopGuard?: boolean
  /** Tool calls that failed in a row at the end of this user turn. */
  readonly failureStreak?: number
  /** System One found a failed result that still blocks the request. */
  readonly toolIssues?: boolean
  /** The previous answer is being repaired after a response-quality review. */
  readonly repair?: boolean
}

export interface ContextSignals {
  /** Estimated input tokens of the request. */
  readonly tokens?: number
  /** The model's context window. */
  readonly window?: number
  /** Advertised tools whose definitions `tokens` does not count. */
  readonly tools?: number
}

export interface State {
  readonly level: Level
  readonly cause: string
  /** The user turn the level last changed at. */
  readonly changedAt: number
  /** User turns seen, counting from one. */
  readonly turn: number
  /** The user message the current turn answers. */
  readonly turnID: string
  /** Whether this turn already used its one step up inside the tool loop. */
  readonly loopStep: boolean
  readonly decider?: Decider
}

export interface Input {
  /** The model's variant names. */
  readonly variants: Iterable<string>
  /** The latest message a person wrote; runtime continuations belong to the same turn. */
  readonly turnID: string
  readonly previous?: State
  readonly assessment?: Assessment
  readonly context?: ContextSignals
  readonly progress?: Progress
  /** The plan agent is working. */
  readonly plan?: boolean
  /** The latest user message, read for an explicit request to think harder. */
  readonly text?: string
  readonly floor?: string
  readonly ceiling?: string
}

export interface Decision {
  readonly level: Level
  readonly cause: string
  readonly state: State
}

/** The effort levels among a model's variants, least thought first. */
export function ladder(variants: Iterable<string>) {
  const names = new Set(variants)
  return LADDER.filter((level) => names.has(level))
}

/** Whether `auto` has anything to choose between: two effort levels at least. */
export const supports = (variants: Iterable<string>) => ladder(variants).length >= 2

/** The variants a person may pick for a model: `auto` first when the model supports it. */
export const options = (variants: ReadonlyArray<string>) =>
  supports(variants) && !variants.includes(AUTO) ? [AUTO, ...variants] : [...variants]

export const isLevel = (value: unknown): value is Level =>
  typeof value === "string" && (LADDER as ReadonlyArray<string>).includes(value)

/**
 * The effort for one request of an `auto` session, or undefined when the model has no effort
 * levels to choose from. Pure: the caller keeps `state` for the next request of the session.
 */
export function decideEffort(input: Input): Decision | undefined {
  const steps = bounded(ladder(input.variants), input.floor, input.ceiling)
  if (steps.length === 0) return undefined
  const previous = input.previous
  if (previous?.turnID === input.turnID) return withinTurn(previous, steps, input.progress)

  const turn = (previous?.turn ?? 0) + 1
  const measured = band(deliberation(input.assessment))
  // Fail open: without an assessment the level the session already has is kept.
  const base = snap(steps, measured ?? previous?.level ?? "medium")
  const origin = measured ? "assessment" : previous ? "kept" : "default"
  const floored = (input.assessment?.impact ?? 0) >= 2 / 3 ? atLeast(steps, base, "medium") : base

  // One step for trouble or for a heavy context, never both: each is a guess.
  const trouble = boundaryTrouble(input.assessment)
  const context = !trouble && heavy(input.context)
  const raised = trouble || context ? move(steps, floored, 1) : floored
  const raisedCause = trouble ?? (context ? "context" : floored !== base ? "impact" : origin)

  const demand = input.plan ? "plan_mode" : explicitThink(input.text) ? "explicit_think" : undefined
  const demanded = demand ? atLeast(steps, raised, "high") : raised
  const demandedCause = demand && demanded !== raised ? demand : raisedCause

  // Approval of healthy work, or a turn that can only ask a question, needs less thought.
  const healthy = !trouble && !demand
  const agrees = healthy && input.assessment?.feedback === "agrees"
  const clarify = healthy && (input.assessment?.mustClarify ?? 0) >= 0.8
  const level = agrees || clarify ? move(steps, demanded, -1) : demanded
  const cause = level !== demanded ? `${demandedCause}+${agrees ? "agrees" : "clarify"}` : demandedCause

  const held = previous ? snap(steps, previous.level) : undefined
  if (previous && held && held !== level) {
    const urgent = LADDER.indexOf(level) > LADDER.indexOf(held) && URGENT.has(cause)
    if (!urgent && turn - previous.changedAt < DWELL_TURNS)
      return {
        level: held,
        cause: "dwell",
        state: { ...previous, level: held, turn, turnID: input.turnID, loopStep: false },
      }
  }
  return {
    level,
    cause,
    state: {
      level,
      cause,
      changedAt: previous && held === level ? previous.changedAt : turn,
      turn,
      turnID: input.turnID,
      loopStep: false,
      ...(previous?.decider ? { decider: previous.decider } : {}),
    },
  }
}

/** Inside a user turn's tool loop the level holds, save one step up per turn on trouble. */
function withinTurn(previous: State, steps: ReadonlyArray<Level>, progress: Progress | undefined): Decision {
  const held = snap(steps, previous.level)
  const trouble = loopTrouble(progress)
  const raised = trouble && !previous.loopStep ? move(steps, held, 1) : held
  if (trouble && raised !== held)
    return {
      level: raised,
      cause: trouble,
      state: { ...previous, level: raised, cause: trouble, changedAt: previous.turn, loopStep: true },
    }
  return { level: held, cause: "hold", state: { ...previous, level: held } }
}

/** What went wrong inside the tool loop that more thought may fix: the first cause that fires. */
function loopTrouble(progress: Progress | undefined) {
  if (progress?.loopGuard) return "loop_guard"
  if ((progress?.failureStreak ?? 0) >= FAILURE_STREAK) return "tool_error"
  if (progress?.toolIssues) return "tool_review"
  if (progress?.repair) return "repair"
  return undefined
}

/** What the person's message says went wrong: the first cause that fires. */
function boundaryTrouble(assessment: Assessment | undefined) {
  if (assessment?.feedback === "corrects" || assessment?.feedback === "rejects") return "feedback"
  if ((assessment?.frustration ?? 0) >= FRUSTRATION_STEP_UP) return "frustration"
  return undefined
}

/** Whether the tool loop looks stuck, as RedRouter's `stall` hint key means it. */
export const stalled = (progress: Progress | undefined) =>
  !!progress?.loopGuard || (progress?.failureStreak ?? 0) >= FAILURE_STREAK

/** How much the work needs thought: the greater of complexity and consequence, as the router hint says. */
function deliberation(assessment: Assessment | undefined) {
  const units = [assessment?.complexity, assessment?.consequence].filter(
    (unit): unit is number => typeof unit === "number" && Number.isFinite(unit),
  )
  return units.length ? Math.min(1, Math.max(0, ...units)) : undefined
}

function band(unit: number | undefined) {
  if (unit === undefined) return undefined
  return BANDS.find(([bound]) => unit < bound)?.[1] ?? "xhigh"
}

function heavy(context: ContextSignals | undefined) {
  const window = context?.window ?? 0
  if (!(window > 0)) return false
  return (context?.tokens ?? 0) + (context?.tools ?? 0) * TOOL_TOKENS > window * CONTEXT_FRACTION
}

/** The model's levels within the configured bounds, or the one nearest them when none fits. */
function bounded(available: ReadonlyArray<Level>, floor: string | undefined, ceiling: string | undefined) {
  if (available.length === 0) return []
  const top = isLevel(ceiling) ? ceiling : CEILING
  const bottom = isLevel(floor) && LADDER.indexOf(floor) <= LADDER.indexOf(top) ? floor : FLOOR
  const within = available.filter(
    (level) => LADDER.indexOf(level) >= LADDER.indexOf(bottom) && LADDER.indexOf(level) <= LADDER.indexOf(top),
  )
  if (within.length) return within
  return [snap(available, LADDER.indexOf(available[0]!) > LADDER.indexOf(top) ? top : bottom)]
}

/** The step nearest a level; a tie goes to the step with more thought. */
function snap(steps: ReadonlyArray<Level>, level: Level) {
  const wanted = LADDER.indexOf(level)
  return steps.reduce((best, step) => {
    const distance = Math.abs(LADDER.indexOf(step) - wanted)
    const bestDistance = Math.abs(LADDER.indexOf(best) - wanted)
    return distance < bestDistance || (distance === bestDistance && LADDER.indexOf(step) > LADDER.indexOf(best))
      ? step
      : best
  })
}

function move(steps: ReadonlyArray<Level>, level: Level, delta: number) {
  const index = steps.indexOf(level)
  return steps[Math.max(0, Math.min(steps.length - 1, index + delta))]!
}

function atLeast(steps: ReadonlyArray<Level>, level: Level, minimum: Level) {
  if (LADDER.indexOf(level) >= LADDER.indexOf(minimum)) return level
  return steps.find((step) => LADDER.indexOf(step) >= LADDER.indexOf(minimum)) ?? steps.at(-1)!
}

// English and Portuguese requests for more thought. Code is removed first so an identifier or a
// quoted prompt does not count; the boundaries are Unicode letters and digits, not ASCII \b.
const THINK = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:ultrathink|think(?:\s+(?:really|very))?\s+(?:hard|harder|deeply|carefully|step\s+by\s+step|it\s+through|this\s+through)|reason\s+carefully|take\s+your\s+time|pense\s+(?:bem|mais|direito|com\s+(?:calma|cuidado)|profundamente|passo\s+a\s+passo)|pensa\s+(?:bem|mais|direito|com\s+(?:calma|cuidado))|raciocine\s+(?:bem|com\s+cuidado)|reflita\s+(?:bem|com\s+cuidado)|analise\s+com\s+cuidado)(?![\p{L}\p{N}_])`,
  "iu",
)

/** Whether a message explicitly asks for more thought ("think hard", "pense bem"). */
export function explicitThink(text: string | undefined) {
  if (!text) return false
  return THINK.test(text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " "))
}

/** Loop guard corrections and the failure streak at the end of a user turn's tool calls. */
export function progress(parts: ReadonlyArray<LoopGuard.Part>): Progress {
  const settled = parts.filter(
    (part) => part.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error"),
  )
  const failed = settled.toReversed().findIndex((part) => part.state?.status !== "error")
  return {
    loopGuard: settled.some((part) => (part.state?.output ?? part.state?.error ?? "").startsWith(LOOP_GUARD_REFUSAL)),
    failureStreak: failed === -1 ? settled.length : failed,
  }
}

export interface Route {
  /** The person chose `auto`; otherwise a manual or default variant applies. */
  readonly auto: boolean
  /** System One runs: Redcode decides and the router must not ask its own decision model. */
  readonly dual: boolean
  /** The level Redcode decided for this request. */
  readonly level?: string
}

export interface Coordination {
  /** Who chooses this request's effort. `none`: the person already did. */
  readonly decider: Decider | "none"
  /** The `x-red-router-reasoning` value to send, if any. */
  readonly header?: string
  /** The router reads the hint on this request even when the model is not a combo. */
  readonly hint: boolean
}

/**
 * Who decides one request's effort, and what RedRouter is told. A person's own variant is never
 * overridden (`off`). With System One, Redcode decides: a combo, whose member is picked per request,
 * gets the level to map onto that member, a direct model keeps the variant in the body (`off`).
 * Without System One, a router whose autopilot accepts `auto` (or already covers the key) decides.
 */
export function coordinate(route: Route, detection: Router.Detection | undefined, combo: boolean): Coordination {
  const features = new Set(detection?.kind === "red-router" ? detection.features : [])
  if (!features.has("reasoning")) return { decider: route.auto ? "redcode" : "none", hint: false }
  if (!route.auto) return { decider: "none", header: "off", hint: false }
  if (!route.dual && features.has("reasoning-auto")) return { decider: "router", header: AUTO, hint: true }
  // An older router whose configured autopilot covers the key decides without being asked.
  if (!route.dual && features.has("reasoning-applies")) return { decider: "router", hint: true }
  if (combo && isLevel(route.level)) return { decider: "redcode", header: route.level, hint: false }
  return { decider: "redcode", header: "off", hint: false }
}

/** What a session shows about its automatic effort: the level, why, and who chose it. */
export interface Display {
  readonly level: string
  readonly cause: string
  readonly decider: Decider
}

export const display = (state: State): Display => ({
  level: state.level,
  cause: state.cause,
  decider: state.decider ?? "redcode",
})

// Per-session state, process-local like the drain itself. Bounded: an idle session loses only its
// dwell, and the next turn starts from the level its assessment gives.
const states = new Map<string, State>()
const LIMIT = 1000

export const recall = (sessionID: string) => states.get(sessionID)

export function remember(sessionID: string, state: State) {
  states.delete(sessionID)
  states.set(sessionID, state)
  if (states.size > LIMIT) states.delete(states.keys().next().value!)
}

/** Records who decided the session's latest request. */
export function note(sessionID: string, decider: Decider) {
  const state = states.get(sessionID)
  if (state && state.decider !== decider) remember(sessionID, { ...state, decider })
}

/**
 * Takes the level RedRouter reported choosing, when the router decided, so the next request carries
 * it in its body too and the session shows what was actually applied.
 */
export function adopt(sessionID: string, report: { readonly level: string; readonly cause?: string } | undefined) {
  const state = states.get(sessionID)
  if (!state || state.decider !== "router" || !report || !isLevel(report.level)) return
  remember(sessionID, { ...state, level: report.level, cause: report.cause ?? state.cause })
}

/** Drops kept state, for one session or all of them. */
export function forget(sessionID?: string) {
  if (sessionID === undefined) return states.clear()
  states.delete(sessionID)
}
