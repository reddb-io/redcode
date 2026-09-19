export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional),
  background: Schema.Boolean.pipe(Schema.optional),
  prune: Schema.Boolean.pipe(Schema.optional),
  keep: Keep.pipe(Schema.optional),
  summary_max_tokens: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum output tokens for the compaction summary itself (default: 32000)",
  }),
  buffer: NonNegativeInt.pipe(Schema.optional),
}) {}
