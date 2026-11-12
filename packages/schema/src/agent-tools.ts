export * as AgentTools from "./agent-tools.js"

import { Schema } from "effect"
import { AbsolutePath, optional, PositiveInt } from "./schema.js"
import { ExecutionCapability } from "./execution-capability.js"

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

export const BrowserExtensionAction = Schema.Literals(["prepare", "install"]).annotate({
  identifier: "AgentTools.BrowserExtensionAction",
})
export type BrowserExtensionAction = typeof BrowserExtensionAction.Type

export const BrowserExtensionID = Schema.String.check(Schema.isPattern(/^[a-p]{32}$/)).annotate({
  identifier: "AgentTools.BrowserExtensionID",
})
export const BrowserExtension = Schema.Struct({
  state: Schema.Literals(["chrome-missing", "not-prepared", "administrator-required", "registered"]),
  chrome: optional(AbsolutePath),
  extensionID: optional(BrowserExtensionID),
  version: optional(Schema.String),
  command: optional(Schema.String),
  canAuthorize: Schema.Boolean,
  error: optional(Schema.String),
}).annotate({ identifier: "AgentTools.BrowserExtension" })
export interface BrowserExtension extends Schema.Schema.Type<typeof BrowserExtension> {}

export const Status = Schema.Struct({
  id: ID,
  settings: Settings,
  supported: Schema.Boolean,
  installed: Schema.Boolean,
  package: Schema.String,
  command: optional(Command),
  extensionDirectory: optional(AbsolutePath),
  browserExtension: optional(BrowserExtension),
  diagnosis: optional(Schema.String),
  checkedAt: optional(Schema.Number),
}).annotate({ identifier: "AgentTools.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const Snapshot = Schema.Struct({
  host: Schema.Struct({ name: Schema.String, platform: Schema.String, arch: Schema.String }),
  tools: Schema.Array(Status),
  /** Operational capability instances; absent on servers predating capability discovery. */
  capabilities: optional(Schema.Array(ExecutionCapability.Info)),
}).annotate({ identifier: "AgentTools.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const Initialize = Schema.Struct({
  directory: AbsolutePath.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)[^\0]*$/)),
}).annotate({ identifier: "AgentTools.Initialize" })
