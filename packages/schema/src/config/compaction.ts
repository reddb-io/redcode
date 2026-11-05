export * as ConfigCompaction from "./compaction.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"

export class Keep extends Schema.Class<Keep>("Config.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(optional),
  turns: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum recent user exchanges kept with a summary or native trigger checkpoint; zero keeps none.",
  }),
}) {}

/** A share of the model window from 1% up to, but not including, 100%. */
export const Percent = Schema.String.check(Schema.isPattern(/^([1-9]\d?(\.\d+)?)%$/u)).annotate({
  identifier: "Config.Compaction.Percent",
})
export type Percent = typeof Percent.Type

export class Info extends Schema.Class<Info>("Config.Compaction")({
  auto: Schema.Boolean.pipe(optional),
  prune: Schema.Boolean.pipe(optional),
  keep: Keep.pipe(optional),
  buffer: Schema.Union([Percent, NonNegativeInt]).pipe(optional).annotate({
    description:
      'Room reserved below the model input limit as a token count or a percentage from "1%" to less than "100%".',
  }),
  summary_max_tokens: PositiveInt.pipe(optional),
  background: Schema.Boolean.pipe(optional).annotate({
    description:
      "Prepare the automatic summary in the background shortly before the context reaches the compaction threshold. Off by default; the prepared summary is used only while the history it covers is unchanged.",
  }),
}) {}
