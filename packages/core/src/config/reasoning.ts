export * as ConfigReasoning from "./reasoning"

import { Schema } from "effect"

const Level = Schema.Literals(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

export class Auto extends Schema.Class<Auto>("ConfigV2.ReasoningAuto")({
  floor: Level.pipe(Schema.optional).annotate({
    description: "Least reasoning effort the auto variant may choose (default: minimal)",
  }),
  ceiling: Level.pipe(Schema.optional).annotate({
    description: "Most reasoning effort the auto variant may choose (default: xhigh)",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Reasoning")({
  auto: Auto.pipe(Schema.optional).annotate({
    description:
      "Bounds for the auto variant, which picks each turn's effort among the model's own variants. Only a model's variants inside the bounds are used.",
  }),
}) {}
