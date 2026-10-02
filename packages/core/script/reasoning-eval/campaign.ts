import { Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { Model } from "@opencode/schema/model"
import { cases } from "./cases"
import { Corpus, codingCorpus } from "./corpus"

const Rate = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
export const Pricing = Schema.Struct({
  source: Schema.NonEmptyString,
  s2: Schema.Struct({ input: Rate, output: Rate, cacheRead: Rate, cacheWrite: Rate }),
  s1: Schema.optional(Schema.Struct({ input: Rate, output: Rate })),
})
export const Pair = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  model: Schema.NonEmptyString,
  responseModel: Schema.NonEmptyString,
  evaluator: Schema.NonEmptyString,
  evaluatorResponseModel: Schema.optional(Schema.NonEmptyString),
  variant: Schema.optional(Model.VariantID),
  pricing: Schema.optional(Pricing),
})
export type Pair = typeof Pair.Type
export const Pairs = Schema.Struct({ pairs: Schema.Array(Pair) })

export const experiments = ["baseline", "verification", "code-repair", "self-review"] as const
export type Experiment = (typeof experiments)[number]

export function switches(experiment: Experiment) {
  return {
    reasoning_code_repair: experiment === "code-repair" || experiment === "self-review",
    reasoning_self_review: experiment === "self-review",
    reasoning_verification: experiment === "verification",
    reasoning_tool_selection: false,
    reasoning_context_curation: false,
    reasoning_learning: false,
  }
}

export function plan(input: {
  suite?: string
  corpus?: string
  split?: string
  experiments?: string
  rounds?: string
  modes?: string
  cases?: string
  timeoutMs?: string
  gate?: boolean
  pairs: readonly Pair[]
}) {
  const suite = Schema.decodeUnknownSync(Schema.Literals(["diagnostic", "coding"]))(input.suite ?? "diagnostic")
  const corpus = Schema.decodeUnknownSync(Corpus)(input.corpus ?? "original")
  if (suite !== "coding" && input.corpus !== undefined) throw new Error("Corpora apply only to the coding suite")
  const split = Schema.decodeUnknownSync(Schema.Literals(["calibration", "held-out", "all"]))(input.split ?? "all")
  const modes = Schema.decodeUnknownSync(Schema.Array(Intelligence.Reasoning))(
    (input.modes ?? "single,dual").split(","),
  )
  const selectedExperiments = Schema.decodeUnknownSync(Schema.Array(Schema.Literals(experiments)))(
    (input.experiments ?? "baseline").split(","),
  )
  if (!modes.length || new Set(modes).size !== modes.length) throw new Error("Select unique reasoning modes")
  if (!selectedExperiments.length || new Set(selectedExperiments).size !== selectedExperiments.length)
    throw new Error("Select unique experiments")
  if (suite !== "coding" && selectedExperiments.some((name) => name === "code-repair" || name === "self-review"))
    throw new Error("Code repair and self-review require the coding suite")
  if (input.gate && (!modes.includes("single") || !modes.includes("dual")))
    throw new Error("The accuracy gate requires both single and dual")
  if (!input.pairs.length || new Set(input.pairs.map((pair) => pair.id)).size !== input.pairs.length)
    throw new Error("Select unique model pair IDs")
  if (input.pairs.some((pair) => pair.model.startsWith("auto/") || pair.evaluator.startsWith("auto/")))
    throw new Error("Use pinned models, not automatic router combos")
  if (input.pairs.some((pair) => pair.model === pair.evaluator))
    throw new Error("Use distinct S1 and S2 selections so provider work can be attributed to each role")
  const rounds = Number(input.rounds ?? "2")
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("Rounds must be between 1 and 10")
  const timeoutMs = Number(input.timeoutMs ?? (suite === "coding" ? "300000" : "90000"))
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new Error("Timeout must be between 1 and 600000 milliseconds")
  if (suite === "diagnostic" && split !== "all") throw new Error("Splits apply only to the coding suite")
  const available =
    suite === "coding" ? codingCorpus(corpus).filter((item) => split === "all" || item.split === split) : cases
  const ids = input.cases?.split(",")
  const selected = available.filter((item) => !ids || ids.includes(item.id))
  if (!selected.length || (ids && selected.length !== new Set(ids).size))
    throw new Error("Unknown, excluded or empty case selection")
  const plans = input.pairs.flatMap((pair) =>
    selectedExperiments.flatMap((experiment) =>
      (["calibration", "held-out"] as const).flatMap((split) => {
        const count = selected.filter((item) =>
          !("split" in item) ? split === "calibration" : item.split === split,
        ).length
        return count
          ? [
              {
                pairID: pair.id,
                experiment,
                split,
                ...(suite === "coding" ? { corpus } : {}),
                expectedRuns: count * rounds * 2,
              },
            ]
          : []
      }),
    ),
  )
  return {
    suite,
    ...(suite === "coding" ? { corpus } : {}),
    split,
    modes,
    rounds,
    timeoutMs,
    selected,
    experiments: selectedExperiments,
    pairs: input.pairs,
    plans,
    expectedExecutions: selected.length * rounds * modes.length * input.pairs.length * selectedExperiments.length,
    expectedComparisons: plans.reduce((total, group) => total + group.expectedRuns, 0),
  }
}
