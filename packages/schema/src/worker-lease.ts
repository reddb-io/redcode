export * as WorkerLease from "./worker-lease.js"

import { Schema } from "effect"
import { AbsolutePath, NonNegativeInt, optional, PositiveInt } from "./schema.js"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"

const Owner = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
export const Claim = Schema.Struct({
  directory: AbsolutePath,
  owner: Owner,
  sessionID: Session.ID,
  messageID: SessionMessage.ID,
}).annotate({ identifier: "WorkerLease.Claim" })
export interface Claim extends Schema.Schema.Type<typeof Claim> {}
export const Fence = Schema.Struct({ owner: Owner, holder: Owner, generation: PositiveInt }).annotate({
  identifier: "WorkerLease.Fence",
})
export interface Fence extends Schema.Schema.Type<typeof Fence> {}
export const Info = Schema.Struct({
  ...Claim.fields,
  holder: Owner,
  generation: PositiveInt,
  expiresAt: PositiveInt,
  /** Remaining duration at the worker when this snapshot was produced. */
  remainingMs: NonNegativeInt,
}).annotate({ identifier: "WorkerLease.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Acquire = Schema.Struct({ ...Claim.fields, holder: Owner, recover: optional(Fence) }).annotate({
  identifier: "WorkerLease.Acquire",
})
export interface Acquire extends Schema.Schema.Type<typeof Acquire> {}
export const Result = Schema.Union([
  Schema.Struct({ state: Schema.Literal("acquired"), lease: Info }),
  Schema.Struct({ state: Schema.Literal("held"), lease: Info }),
  Schema.Struct({ state: Schema.Literal("released"), lease: Info }),
  Schema.Struct({ state: Schema.Literal("busy") }),
]).annotate({ identifier: "WorkerLease.Result" })
export type Result = typeof Result.Type
