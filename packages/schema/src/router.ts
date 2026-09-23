export * as Router from "./router"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"

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
  "catalog",
  "reasoning",
  "reasoning-auto",
  "reasoning-applies",
  "hint-signals",
  "recommendations",
]).annotate({ identifier: "Router.Feature" })
export type Feature = typeof Feature.Type

export const Detection = Schema.Struct({
  kind: Kind,
  version: Schema.String.pipe(optional),
  instanceID: Schema.String.pipe(optional),
  catalogVersion: Schema.String.pipe(optional).annotate({
    description:
      "Digest of the model catalog the key sees. It changes when combos, their members or model limits change.",
  }),
  features: Schema.Array(Feature),
  systemOne: Schema.Struct({
    available: Schema.Boolean,
    models: Schema.Array(Schema.String),
  }).pipe(optional),
  checkedAt: Schema.Finite.annotate({ description: "Epoch milliseconds of the probe." }),
}).annotate({ identifier: "Router.Detection" })
export interface Detection extends Schema.Schema.Type<typeof Detection> {}

/**
 * The router a provider connection was found to be, saved on the provider when it is connected or
 * its models are refreshed. Clients read it to tell a RedRouter connection from a direct provider
 * without relying on the provider id.
 */
export const Connection = Schema.Struct({
  kind: Schema.Literals(["red-router", "9router"]),
  instanceID: Schema.String.pipe(optional),
  version: Schema.String.pipe(optional),
}).annotate({ identifier: "Router.Connection" })
export interface Connection extends Schema.Schema.Type<typeof Connection> {}

/**
 * The provider behind a model a router serves: its id, the slug in the model id, its display name,
 * a category (`custom` for a node the user added, `combo` for a combo) and whether it is a
 * subscription account rather than pay-per-use.
 */
export const Upstream = Schema.Struct({
  id: Schema.String,
  slug: Schema.String.pipe(optional),
  name: Schema.String,
  category: Schema.String.pipe(optional),
  subscription: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Router.Upstream" })
export interface Upstream extends Schema.Schema.Type<typeof Upstream> {}

/**
 * A reasoning level (`level`) or mode (`mode`, e.g. review) a router serves under one model entry
 * instead of as a separate model. Requesting `id` (or one of its earlier `aliases`) asks the router
 * for that level or mode.
 */
export const Variant = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(optional),
  level: Schema.String.pipe(optional),
  mode: Schema.String.pipe(optional),
  aliases: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Router.Variant" })
export interface Variant extends Schema.Schema.Type<typeof Variant> {}

/**
 * A model a router recommends for one role, from the accounts the key has connected: its model id
 * at the router, display name, the upstream provider that serves it and why it was chosen.
 */
export const Recommendation = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String,
  provider: Schema.Struct({ slug: Schema.String, name: Schema.String }),
  reason: Schema.String,
}).annotate({ identifier: "Router.Recommendation" })
export interface Recommendation extends Schema.Schema.Type<typeof Recommendation> {}

/**
 * The router's recommended model per role: `default` for the principal, `fast` for
 * transformations, `review` for review, `systemone` for the System One evaluator and `vision` for
 * images. A role the router has no model for is absent.
 */
export const Recommendations = Schema.Struct({
  default: Recommendation.pipe(optional),
  fast: Recommendation.pipe(optional),
  review: Recommendation.pipe(optional),
  systemone: Recommendation.pipe(optional),
  vision: Recommendation.pipe(optional),
}).annotate({ identifier: "Router.Recommendations" })
export interface Recommendations extends Schema.Schema.Type<typeof Recommendations> {}

/**
 * A router's model catalog changed and its saved models were read again: `added` and `removed`
 * count models, `renamed` counts saved ids moved to the router's new id for the same model.
 */
export const CatalogUpdated = define({
  type: "provider.catalog.updated",
  schema: {
    providerID: Schema.String,
    name: Schema.String,
    added: Schema.Finite,
    removed: Schema.Finite,
    renamed: Schema.Finite,
  },
})
export const Event = { CatalogUpdated, Definitions: inventory(CatalogUpdated) }
