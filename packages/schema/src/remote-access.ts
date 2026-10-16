export * as RemoteAccess from "./remote-access.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Status = Schema.Struct({
  available: Schema.Boolean,
  state: Schema.Literals(["disabled", "provisioning", "connecting", "ready", "failed"]),
  relay: optional(Schema.String),
  url: optional(Schema.String),
  detail: optional(Schema.String),
}).annotate({ identifier: "RemoteAccess.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const Configure = Schema.Struct({
  relay: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  acceptExposure: Schema.Literal(true),
}).annotate({ identifier: "RemoteAccess.Configure" })
export interface Configure extends Schema.Schema.Type<typeof Configure> {}
