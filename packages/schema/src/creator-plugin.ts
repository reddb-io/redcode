export * as CreatorPlugin from "./creator-plugin.js"

import { Schema } from "effect"
import { Design } from "./design.js"
import { Session } from "./session.js"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.check(Schema.isPattern(/^cplugin_[a-f0-9-]{36}$/)).pipe(
  Schema.brand("CreatorPlugin.ID"),
)
export type ID = typeof ID.Type
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export const Source = Schema.Struct({ sessionID: Session.ID, designID: Design.ID, revision: Schema.NonEmptyString })
export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Candidate = Schema.Struct({
  ...Source.fields,
  name: Schema.String,
  entry: Schema.String,
  capabilities: Schema.Array(Schema.String),
})
export const Report = Schema.Struct({
  passed: Schema.Boolean,
  time: Schema.Number,
  message: Schema.String,
  pluginID: Schema.String.pipe(optional),
  tools: Schema.Array(Schema.String),
})
export interface Report extends Schema.Schema.Type<typeof Report> {}
export const Info = Schema.Struct({
  ...Candidate.fields,
  id: ID,
  packageName: Schema.String,
  packageVersion: Schema.String,
  enabled: Schema.Boolean,
  version: Version,
  created: Schema.Number,
  report: Report.pipe(optional),
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Entry = Schema.Struct({
  ...Info.fields,
  runtime: Schema.Literals(["disabled", "pending", "active", "failed"]),
  error: Schema.String.pipe(optional),
})
export const Review = Schema.Struct({
  ...Candidate.fields,
  packageName: Schema.String,
  packageVersion: Schema.String,
  files: Schema.Array(Schema.String),
  bytes: Schema.Number,
  dependencies: Schema.Array(Schema.String),
})
export const Control = Schema.Struct({ expectedVersion: Version, enabled: Schema.Boolean })
export const Expected = Schema.Struct({ expectedVersion: Version })
const Updated = ephemeral({ type: "creator.plugin.updated", schema: { pluginID: ID } })
export const Event = { Updated, Definitions: inventory(Updated) }
