export * as Satisfaction from "./satisfaction.js"

import type { Answer } from "./intelligence.js"

/**
 * How the user is taking the session, read from what System One already classifies for every prompt: how the user's
 * message judges the agent's previous work (`user_feedback`) and how frustrated they are (`frustration`). No extra
 * model call is made and nothing is stored: the score is folded from the session's classifications each time.
 *
 * It measures the user's reaction, not the work: a session can go well with a user who never says so, which reads as
 * steady, and it never reads a message's words itself, so it holds for every language.
 */

/** The least confidence at which an answer counts, the same bar the classification's other consumers use. */
export const CONFIDENCE = 0.6

/** How much less each earlier prompt weighs than the next one: the mood follows the latest turns. */
export const DECAY = 0.6

/** Prompts needed before a stage is shown; one reaction is not a trend. */
export const MINIMUM = 3

/** The user's reaction to the previous work, as a value from -1 (rejected) to 1 (approved). */
const FEEDBACK: Readonly<Record<string, number>> = { agrees: 1, neutral: 0, corrects: -0.4, rejects: -1 }

/** The weight of frustration against the reaction to the work. */
const FRUSTRATION = 0.8

/** The five stages, from the worst to the best. */
export const STAGES = ["frustrated", "rough", "steady", "good", "great"] as const
export type Stage = (typeof STAGES)[number]

/** One block glyph per stage, growing with satisfaction, for a footer that has room for one character. */
export const GLYPHS = ["▁", "▂", "▄", "▆", "█"] as const

/** The evaluation fields this reads; `Intelligence.Evaluation` satisfies it. */
export interface Evaluation {
  readonly operation: string
  readonly decision: string
  readonly created: number
  readonly answers: Readonly<Record<string, Answer>>
}

/** One prompt's value from -1 to 1, or undefined when System One gave neither signal reliably. */
export function sample(evaluation: Evaluation) {
  if (evaluation.operation !== "prompt_classification" || evaluation.decision === "unavailable") return undefined
  const feedback = evaluation.answers.user_feedback
  const reaction =
    feedback?.type === "choice" && feedback.confidence >= CONFIDENCE ? FEEDBACK[feedback.choice] : undefined
  const frustration = unit(evaluation.answers.frustration)
  if (reaction === undefined && frustration === undefined) return undefined
  return Math.min(1, Math.max(-1, (reaction ?? 0) - FRUSTRATION * (frustration ?? 0)))
}

/** A reliable score answer scaled to 0..1 by its legend, or undefined. */
function unit(answer: Answer | undefined) {
  if (answer?.type !== "score" || answer.confidence < CONFIDENCE || !Number.isFinite(answer.score)) return undefined
  const top = Object.keys(answer.legend).length - 1
  return top < 1 ? undefined : Math.min(1, Math.max(0, answer.score / top))
}

/** The stage for a mood from -1 to 1. */
export function stage(mood: number): Stage {
  if (mood >= 0.5) return "great"
  if (mood >= 0.15) return "good"
  if (mood > -0.15) return "steady"
  if (mood > -0.5) return "rough"
  return "frustrated"
}

/**
 * The session's satisfaction from its evaluations, in any order: the weighted mood of its prompts with the latest
 * weighing most, and its stage; undefined until {@link MINIMUM} prompts were read.
 */
export function read(evaluations: ReadonlyArray<Evaluation>) {
  const values = evaluations
    .toSorted((left, right) => left.created - right.created)
    .flatMap((evaluation) => {
      const value = sample(evaluation)
      return value === undefined ? [] : [value]
    })
  if (values.length < MINIMUM) return undefined
  const weights = values.map((_, index) => DECAY ** (values.length - 1 - index))
  const mood =
    values.reduce((total, value, index) => total + value * weights[index]!, 0) / weights.reduce((a, b) => a + b, 0)
  return { mood, stage: stage(mood), samples: values.length }
}

/** The glyph of a stage. */
export const glyph = (value: Stage) => GLYPHS[STAGES.indexOf(value)]!
