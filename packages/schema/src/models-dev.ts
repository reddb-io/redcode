export * as ModelsDev from "./models-dev.js"

import { ephemeral, inventory } from "./event.js"
import { Schema } from "effect"
import { optional } from "./schema.js"

export const CatalogStatus = Schema.Struct({
  source: Schema.Literals(["remote", "file", "cache", "bundled", "empty"]),
  origin: Schema.String.pipe(optional),
  updatedAt: Schema.Finite.pipe(optional),
  refreshEnabled: Schema.Boolean,
}).annotate({ identifier: "ModelsDev.CatalogStatus" })
export type CatalogStatus = typeof CatalogStatus.Type

export const CatalogRefresh = Schema.Struct({
  outcome: Schema.Literals(["updated", "unchanged", "unavailable", "disabled"]),
  catalog: CatalogStatus,
}).annotate({ identifier: "ModelsDev.CatalogRefresh" })
export type CatalogRefresh = typeof CatalogRefresh.Type

const Refreshed = ephemeral({
  type: "models-dev.refreshed",
  schema: {},
})
export const Event = { Refreshed, Definitions: inventory(Refreshed) }
