export * as ExecutionCapability from "./execution-capability.js"

import { Schema } from "effect"
import { SessionID } from "./session-id.js"
import { optional } from "./schema.js"

export const ID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(160),
  Schema.isPattern(/^[A-Za-z0-9._:-]+$/),
).pipe(Schema.brand("ExecutionCapability.ID"))
export type ID = typeof ID.Type

export const Kind = Schema.Literals(["browser", "desktop", "terminal", "workspace", "other"]).annotate({
  identifier: "ExecutionCapability.Kind",
})
export type Kind = typeof Kind.Type

export const Source = Schema.Literals(["builtin", "managed", "custom", "client-mcp", "worker"]).annotate({
  identifier: "ExecutionCapability.Source",
})
export type Source = typeof Source.Type

export const Status = Schema.Literals(["unavailable", "disabled", "available", "connecting", "ready", "degraded"]).annotate({
  identifier: "ExecutionCapability.Status",
})
export type Status = typeof Status.Type

export const Risk = Schema.Literals(["observe", "interactive", "privileged"]).annotate({
  identifier: "ExecutionCapability.Risk",
})
export type Risk = typeof Risk.Type

export const Target = Schema.Struct({
  type: Schema.Literals(["server", "client", "worker"]),
  id: Schema.String,
  name: Schema.String,
  platform: optional(Schema.String),
  arch: optional(Schema.String),
}).annotate({ identifier: "ExecutionCapability.Target" })
export interface Target extends Schema.Schema.Type<typeof Target> {}

export const Provider = Schema.Union([
  Schema.Struct({ type: Schema.Literal("plugin"), id: Schema.String, name: optional(Schema.String) }),
]).annotate({ identifier: "ExecutionCapability.Provider" })
export type Provider = typeof Provider.Type

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  kind: Kind,
  source: Source,
  status: Status,
  risk: Risk,
  target: Target,
  /** The component that advertised this capability. Source still describes how that component is delivered. */
  provider: optional(Provider),
  sessionID: optional(SessionID),
  operations: Schema.Array(Schema.String),
  detail: optional(Schema.String),
  checkedAt: optional(Schema.Finite),
}).annotate({ identifier: "ExecutionCapability.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
