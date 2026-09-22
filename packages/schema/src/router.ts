export * as Router from "./router"

import { Schema } from "effect"
import { optional } from "./schema"

/**
 * What answered at a provider's base URL. `red-router` published its capabilities (or its System
 * One catalog); `9router` is a router of the 9Router family that only answered the public version
 * fingerprint; `none` is anything else, including an unreachable address.
 */
export const Kind = Schema.Literals(["red-router", "9router", "none"]).annotate({ identifier: "Router.Kind" })
export type Kind = typeof Kind.Type

/** Router behaviours a client may rely on once detected. */
export const Feature = Schema.Literals([
  "capabilities",
  "systemone",
  "combos",
  "decision",
  "hint",
  "token-saver",
  "session-affinity",
  "served-model",
  "cost",
  "stream-usage-cost",
]).annotate({ identifier: "Router.Feature" })
export type Feature = typeof Feature.Type

export const Detection = Schema.Struct({
  kind: Kind,
  version: Schema.String.pipe(optional),
  instanceID: Schema.String.pipe(optional),
  features: Schema.Array(Feature),
  systemOne: Schema.Struct({
    available: Schema.Boolean,
    models: Schema.Array(Schema.String),
  }).pipe(optional),
  checkedAt: Schema.Finite.annotate({ description: "Epoch milliseconds of the probe." }),
}).annotate({ identifier: "Router.Detection" })
export interface Detection extends Schema.Schema.Type<typeof Detection> {}
