export * as ProviderRemoval from "./provider-removal.js"

import { Schema } from "effect"

export const Result = Schema.Struct({
  providerID: Schema.String,
  dryRun: Schema.Boolean,
  removed: Schema.Struct({
    credentials: Schema.Int,
    config: Schema.Boolean,
    references: Schema.Array(Schema.String),
    learnedLimits: Schema.Int,
    hidden: Schema.Boolean,
  }),
  configPath: Schema.String,
  referencingFiles: Schema.Array(Schema.String),
  envVariables: Schema.Array(Schema.String),
}).annotate({ identifier: "ProviderRemoval.Result" })
export type Result = typeof Result.Type
