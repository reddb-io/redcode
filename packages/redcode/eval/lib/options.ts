/**
 * Eval options travel from the runner (`bun run eval`) to the bun test process as environment
 * variables, because bun test rejects flags it does not know.
 */
import path from "node:path"
import type { Pricing } from "./pilot"

export const SCRIPTED_MODEL = "scripted/replay"

export interface Options {
  readonly mode: "scripted" | "live"
  readonly pilot: boolean
  readonly hermetic: boolean
  readonly model: string
  readonly runId: string
  readonly history: string
  /** Hard spend limit for the whole run, required live. */
  readonly budgetUsd?: number
  readonly judge?: string
  readonly judgeFamily?: string
  readonly pricing?: Pricing
  readonly family?: string
  /** Live only: write the run's steps out as a cassette. */
  readonly record: boolean
  /** Replay `<eval>.<suffix>.json` instead of `<eval>.json`. */
  readonly cassette?: string
}

export class OptionsError extends Error {}

export function defaultHistory(cwd: string) {
  return path.join(cwd, ".red", "code", "eval", "history.jsonl")
}

/** Pilot estimates live next to the history, never in it: they are not runs. */
export function pilotPath(history: string) {
  return path.join(path.dirname(history), "pilot.jsonl")
}

export function parse(env: Record<string, string | undefined>, cwd = process.cwd()): Options {
  const live = env.REDCODE_EVAL_LIVE === "1"
  const model = env.REDCODE_EVAL_MODEL || SCRIPTED_MODEL
  const budget = env.REDCODE_EVAL_BUDGET_USD ? Number(env.REDCODE_EVAL_BUDGET_USD) : undefined
  const pilot = truthy(env.REDCODE_EVAL_PILOT)
  if (budget !== undefined && !(Number.isFinite(budget) && budget > 0))
    throw new OptionsError(`REDCODE_EVAL_BUDGET_USD must be a positive number, got ${env.REDCODE_EVAL_BUDGET_USD}`)
  // A pilot never calls the model, so it may name a real one without the live switch.
  if (!live && !pilot && model !== SCRIPTED_MODEL)
    throw new OptionsError(
      `${model} is a real model: set REDCODE_EVAL_LIVE=1 and a budget to call it, or add --pilot to estimate its cost`,
    )
  if (live && !pilot) {
    if (model === SCRIPTED_MODEL || !model.includes("/"))
      throw new OptionsError("live evals need --model <provider>/<model>")
    if (budget === undefined) throw new OptionsError("live evals need a hard budget: --budget <usd>")
  }
  return {
    mode: live && !pilot ? "live" : "scripted",
    pilot,
    hermetic: truthy(env.REDCODE_EVAL_HERMETIC),
    model,
    runId: env.REDCODE_EVAL_RUN_ID || `local-${Date.now().toString(36)}`,
    history: env.REDCODE_EVAL_HISTORY || defaultHistory(cwd),
    ...(budget !== undefined ? { budgetUsd: budget } : {}),
    ...(env.REDCODE_EVAL_JUDGE ? { judge: env.REDCODE_EVAL_JUDGE } : {}),
    ...(env.REDCODE_EVAL_JUDGE_FAMILY ? { judgeFamily: env.REDCODE_EVAL_JUDGE_FAMILY } : {}),
    ...(env.REDCODE_EVAL_PRICING ? { pricing: JSON.parse(env.REDCODE_EVAL_PRICING) as Pricing } : {}),
    ...(env.REDCODE_EVAL_FAMILY ? { family: env.REDCODE_EVAL_FAMILY } : {}),
    record: live && truthy(env.REDCODE_EVAL_RECORD),
    ...(env.REDCODE_EVAL_CASSETTE ? { cassette: env.REDCODE_EVAL_CASSETTE } : {}),
  }
}

function truthy(value: string | undefined) {
  return value === "1" || value === "true"
}

export * as EvalOptions from "./options"
