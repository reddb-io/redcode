export * as AgentTools from "./agent-tools.js"

import { Schema } from "effect"
import { AbsolutePath, optional, PositiveInt } from "./schema.js"

export const ID = Schema.Literals(["rift", "browser-control", "terminal-control", "computer-use"]).annotate({
  identifier: "AgentTools.ID",
})
export type ID = typeof ID.Type

export const Command = Schema.Array(Schema.NonEmptyString.check(Schema.isPattern(/^[^\0]+$/))).check(
  Schema.isMinLength(1),
)
export const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  command: optional(Command).annotate({ description: "Rift CLI or MCP stdio command on the execution host." }),
  timeout: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(600_000))),
  copyAll: optional(Schema.Boolean).annotate({ description: "Include regenerable caches in Rift snapshots." }),
}).annotate({ identifier: "AgentTools.Settings" })
export interface Settings extends Schema.Schema.Type<typeof Settings> {}

export const Configure = Schema.Struct({ id: ID, settings: Settings }).annotate({ identifier: "AgentTools.Configure" })
export interface Configure extends Schema.Schema.Type<typeof Configure> {}

export const Status = Schema.Struct({
  id: ID,
  settings: Settings,
  supported: Schema.Boolean,
  installed: Schema.Boolean,
  package: Schema.String,
  command: optional(Command),
  extensionDirectory: optional(AbsolutePath),
  diagnosis: optional(Schema.String),
  checkedAt: optional(Schema.Number),
}).annotate({ identifier: "AgentTools.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const Snapshot = Schema.Struct({
  host: Schema.Struct({ name: Schema.String, platform: Schema.String, arch: Schema.String }),
  tools: Schema.Array(Status),
}).annotate({ identifier: "AgentTools.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const Initialize = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)[^\0]*$/)),
}).annotate({ identifier: "AgentTools.Initialize" })
