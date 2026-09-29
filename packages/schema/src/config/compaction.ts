export * as ConfigCompaction from "./compaction.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"

export class Keep extends Schema.Class<Keep>("Config.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(optional),
  turns: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum recent user exchanges kept with a summary or native trigger checkpoint; zero keeps none.",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.Compaction")({
  auto: Schema.Boolean.pipe(optional),
  prune: Schema.Boolean.pipe(optional),
  keep: Keep.pipe(optional),
  buffer: NonNegativeInt.pipe(optional),
  summary_max_tokens: PositiveInt.pipe(optional),
  background: Schema.Boolean.pipe(optional).annotate({
    description:
      "Prepare the automatic summary in the background shortly before the context reaches the compaction threshold. Off by default; the prepared summary is used only while the history it covers is unchanged.",
  }),
}) {}
