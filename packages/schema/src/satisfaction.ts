export * as Satisfaction from "./satisfaction.js"

import type { Answer } from "./intelligence.js"
import { STOP_LOSS_PROGRESSED } from "./session-guard.js"

/**
 * Accumulated friction with the agent's work, not a classification of the user's emotions. Existing S1 feedback
 * and frustration evidence heats the session; confirmed improvement cools it. Neutral continuations preserve the
 * reading. No extra model call or durable score: the same chronological fold serves the TUI and S2 prompts.
 */

/** The least confidence at which an answer counts, the same bar the classification's other consumers use. */
export const CONFIDENCE = 0.6

/** Prompts needed before a stage is shown; one reaction is not a trend. */
export const MINIMUM = 3

/** Corrections and failed work accumulate faster than confirmed improvement cools the session. */
const FEEDBACK: Readonly<Record<string, number>> = { agrees: -0.15, neutral: 0, corrects: 0.2, rejects: 0.35 }
const FRUSTRATION = 0.4

/** Failure stops heat less than direct feedback; verified recovery cools by a smaller amount. */
const STOP = 0.1
const RECOVERED = -0.05

/** The guards whose `stop` means the work did not get where the user asked. */
const STOPPING_GUARDS: ReadonlySet<string> = new Set(["stop_loss", "goal", "loop", "steps", "stall"])

/** The guard log entries this reads; `SessionGuard.Entry` satisfies it. */
export interface Trip {
  readonly guard: string
  readonly action: string
  readonly subject?: string
  readonly at: number
}

/** Temperature stages, without attributing an emotional state to the user. */
export const STAGES = ["cool", "warming", "warm", "hot", "critical"] as const
export type Stage = (typeof STAGES)[number]

/** A one-column vertical thermometer: empty, then five levels filling from bottom to top. */
export const GLYPHS = ["▯", "▁", "▂", "▄", "▆", "█"] as const

/** The evaluation fields this reads; `Intelligence.Evaluation` satisfies it. */
export interface Evaluation {
  readonly operation: string
  readonly decision: string
  readonly created: number
  readonly answers: Readonly<Record<string, Answer>>
}

/** One prompt's temperature change, or undefined when neither signal is reliable. */
export function sample(evaluation: Evaluation) {
  if (evaluation.operation !== "prompt_classification" || evaluation.decision === "unavailable") return undefined
  const feedback = evaluation.answers.user_feedback
  const reaction =
    feedback?.type === "choice" && feedback.confidence >= CONFIDENCE ? FEEDBACK[feedback.choice] : undefined
  const frustration = unit(evaluation.answers.frustration)
  if (reaction === undefined && frustration === undefined) return undefined
  // Approval while an issue still causes friction must not cancel that evidence.
  return frustration !== undefined && frustration > 0
    ? Math.max(reaction ?? 0, FRUSTRATION * frustration)
    : (reaction ?? 0)
}

/** A reliable score answer scaled to 0..1 by its legend, or undefined. */
function unit(answer: Answer | undefined) {
  if (answer?.type !== "score" || answer.confidence < CONFIDENCE || !Number.isFinite(answer.score)) return undefined
  const top = Object.keys(answer.legend).length - 1
  return top < 1 ? undefined : Math.min(1, Math.max(0, answer.score / top))
}

/** The stage for accumulated friction from 0 to 1. */
export function stage(temperature: number): Stage {
  if (temperature >= 0.8) return "critical"
  if (temperature >= 0.6) return "hot"
  if (temperature >= 0.4) return "warm"
  if (temperature > 0) return "warming"
  return "cool"
}

/**
 * How far the reading is from showing: the prompts System One classified, and how many of them it read with enough
 * confidence to count. A session whose prompts are all classified but none read shows why nothing appears.
 */
export function progress(evaluations: ReadonlyArray<Evaluation>) {
  const classified = evaluations.filter(
    (evaluation) => evaluation.operation === "prompt_classification" && evaluation.decision !== "unavailable",
  )
  const usable = classified.filter((evaluation) => sample(evaluation) !== undefined).length
  return { classified: classified.length, usable, needed: MINIMUM }
}

/** Failure and recovery evidence inside the retained classification history. */
export function work(trips: ReadonlyArray<Trip>, since: number) {
  const recent = trips.filter((trip) => trip.at >= since)
  const stops = recent.filter((trip) => trip.action === "stop" && STOPPING_GUARDS.has(trip.guard)).length
  const recovered = recent.filter((trip) => trip.subject === STOP_LOSS_PROGRESSED).length
  return { stops, recovered }
}

/**
 * Fold temperature changes in chronological order. Neutral or unavailable feedback never cools accumulated
 * friction. Undefined until {@link MINIMUM} prompts were reliably read; the result remains advisory evidence.
 */
export function read(evaluations: ReadonlyArray<Evaluation>, trips: ReadonlyArray<Trip> = []) {
  const rated = evaluations
    .toSorted((left, right) => left.created - right.created)
    .flatMap((evaluation) => {
      const value = sample(evaluation)
      return value === undefined ? [] : [{ value, created: evaluation.created }]
    })
  if (rated.length < MINIMUM) return undefined
  const recent = trips.filter((trip) => trip.at >= rated[0]!.created)
  const temperature = [
    ...rated,
    ...recent.flatMap((trip) => {
      if (trip.action === "stop" && STOPPING_GUARDS.has(trip.guard)) return [{ value: STOP, created: trip.at }]
      if (trip.subject === STOP_LOSS_PROGRESSED) return [{ value: RECOVERED, created: trip.at }]
      return []
    }),
  ]
    .toSorted((left, right) => left.created - right.created)
    .reduce((value, item) => Math.min(1, Math.max(0, value + item.value)), 0)
  return {
    temperature,
    score: Math.round(temperature * 5),
    stage: stage(temperature),
    samples: rated.length,
    ...work(recent, rated[0]!.created),
  }
}

/** The glyph of a measured integer temperature from 0 to 5. */
export const glyph = (score: number) => GLYPHS[score]!
