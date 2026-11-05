export * as SessionArtifact from "./session-artifact.js"

import { Schema } from "effect"

export const Revision = Schema.Struct({
  id: Schema.String,
  created: Schema.Number,
  entry: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
})
export const Info = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  title: Schema.String,
  created: Schema.Number,
  updated: Schema.Number,
  revisions: Schema.Array(Revision),
})
export const Publish = Schema.Struct({
  source: Schema.String,
  title: Schema.optional(Schema.String),
  entry: Schema.String,
  id: Schema.optional(Schema.String),
  expectedRevision: Schema.optional(Schema.String),
})
