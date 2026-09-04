/**
 * What to do as a turn approaches the wall.
 *
 * The ceiling used to be a cliff: at step 200 the turn was cut off and everything the model had
 * worked out but not yet written down went with it. The user is told to "send another message to
 * continue", but the reasoning that would have made that message useful is gone.
 *
 * A step before the wall is enough to ask for the thing that makes the loss recoverable: a report
 * of what was done, what is left, and what to do next. The wall stays where it was, for a model
 * that will not yield.
 */

/** Deliberately far above any real turn: this is the wall that stops a runaway, not a budget. */
export const CEILING = 200

/**
 * Steps of grace between the request for a report and the wall.
 *
 * More than one because a model asked to summarise sometimes makes one last tool call first;
 * few, because each is a full request against a turn already known to be over budget.
 */
export const GRACE = 2

export interface Limits {
  readonly wrapUpAt: number
  readonly stopAt: number
}

export function limits(config?: false | { wrap_up_at?: number; stop_at?: number }): Limits | undefined {
  if (config === false) return undefined
  const stopAt = config?.stop_at ?? CEILING
  const wrapUpAt = config?.wrap_up_at ?? Math.max(1, stopAt - GRACE)
  if (stopAt <= 0) return undefined
  return { stopAt, wrapUpAt: Math.min(wrapUpAt, stopAt) }
}

export type Decision =
  | { readonly type: "run" }
  /** Tools stay available, but the model is told to finish and report. */
  | { readonly type: "wrap-up"; readonly remaining: number }
  | { readonly type: "stop"; readonly message: string }

export function decide(input: { step: number; limits?: Limits }): Decision {
  if (!input.limits) return { type: "run" }
  const { wrapUpAt, stopAt } = input.limits
  if (input.step >= stopAt) return { type: "stop", message: stopped(input.step) }
  if (input.step >= wrapUpAt) return { type: "wrap-up", remaining: stopAt - input.step }
  return { type: "run" }
}

export function stopped(step: number) {
  return `This turn ran ${step} steps without finishing and was stopped. Send another message to continue it.`
}

export * as StepBudget from "./step-budget"
