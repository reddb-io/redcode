export * as ModelPerformance from "./model-performance.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { NonNegativeInt, optional } from "./schema.js"

const Metrics = {
  requests: NonNegativeInt,
  errors: NonNegativeInt,
  latencyP50: Schema.Finite.pipe(optional),
  latencyP95: Schema.Finite.pipe(optional),
  throughputP50: Schema.Finite.pipe(optional),
}

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  providerID: Schema.String,
  ...Metrics,
}).annotate({ identifier: "ModelPerformance.Provider" })

export interface ModelEntry extends Schema.Schema.Type<typeof ModelEntry> {}
export const ModelEntry = Schema.Struct({
  model: Model.Ref,
  ...Metrics,
}).annotate({ identifier: "ModelPerformance.Model" })

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  sampledAt: Schema.Finite,
  from: Schema.Finite,
  ...Metrics,
  providers: Schema.Array(Provider),
  models: Schema.Array(ModelEntry),
}).annotate({ identifier: "ModelPerformance.Snapshot" })
