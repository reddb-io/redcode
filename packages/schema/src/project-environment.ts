export * as ProjectEnvironment from "./project-environment.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"

export const ID = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/)).annotate({
  identifier: "ProjectEnvironment.ID",
})
export type ID = typeof ID.Type
const Script = Schema.String.check(Schema.isMaxLength(8192))
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
export const Action = Schema.Literals(["prepare", "start", "stop", "recreate", "validate", "reconcile"]).annotate({
  identifier: "ProjectEnvironment.Action",
})
export type Action = typeof Action.Type

export const Definition = Schema.Struct({
  id: ID,
  name: Text,
  backend: Schema.Literals(["compose", "commands"]),
  composeFile: Text,
  prepare: Script,
  start: Script,
  stop: Script,
  validate: Script,
  timeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1800 })),
  /** Environment variable -> project Vault name. Values are never stored here. */
  secrets: Schema.Record(
    Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
    Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
  ),
}).annotate({ identifier: "ProjectEnvironment.Definition" })
export interface Definition extends Schema.Schema.Type<typeof Definition> {}

export const Recipe = Schema.Struct({
  ...Definition.fields,
  projectID: Schema.String,
  revision: Schema.Int,
  updatedAt: Schema.String,
  validatedRevision: optional(Schema.Int),
  validatedAt: optional(Schema.String),
}).annotate({ identifier: "ProjectEnvironment.Recipe" })
export interface Recipe extends Schema.Schema.Type<typeof Recipe> {}

export const Save = Schema.Struct({
  directory: AbsolutePath,
  expectedRevision: Schema.Int,
  definition: Definition,
}).annotate({ identifier: "ProjectEnvironment.Save" })
export interface Save extends Schema.Schema.Type<typeof Save> {}

export const Target = Schema.Struct({ directory: AbsolutePath, recipeID: ID }).annotate({
  identifier: "ProjectEnvironment.Target",
})
export interface Target extends Schema.Schema.Type<typeof Target> {}

export const Run = Schema.Struct({
  ...Target.fields,
  action: Action,
  revision: Schema.Int,
  requestID: Text,
  confirmReconciled: optional(Schema.Boolean),
}).annotate({ identifier: "ProjectEnvironment.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}

export const Info = Schema.Struct({
  ...Target.fields,
  id: Schema.String,
  projectID: Schema.String,
  composeProject: Schema.String,
  revision: Schema.Int,
  state: Schema.Literals(["stopped", "prepared", "ready", "working", "failed", "reconcile", "reconciled"]),
  action: Action,
  requestID: Text,
  updatedAt: Schema.String,
  output: Schema.String,
  detail: optional(Schema.String),
  validatedAt: optional(Schema.String),
}).annotate({ identifier: "ProjectEnvironment.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Snapshot = Schema.Struct({
  directory: AbsolutePath,
  projectID: Schema.String,
  recipes: Schema.Array(Recipe),
  environments: Schema.Array(Info),
}).annotate({ identifier: "ProjectEnvironment.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
