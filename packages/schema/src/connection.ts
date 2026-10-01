export * as Connection from "./connection.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"

export interface CredentialInfo extends Schema.Schema.Type<typeof CredentialInfo> {}
export const CredentialInfo = Schema.Struct({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
  /** How the credential was obtained: a stored key or an OAuth grant. */
  method: Schema.Literals(["key", "oauth"]),
}).annotate({ identifier: "Connection.CredentialInfo" })

export interface EnvInfo extends Schema.Schema.Type<typeof EnvInfo> {}
export const EnvInfo = Schema.Struct({
  type: Schema.Literal("env"),
  name: Schema.String,
}).annotate({ identifier: "Connection.EnvInfo" })

export const Info = Schema.Union([CredentialInfo, EnvInfo])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = typeof Info.Type

/** Stable access identity; labels and refreshed OAuth tokens are not part of a selection. */
export const Ref = Schema.Union([
  Schema.Struct({ type: Schema.Literal("credential"), id: Credential.ID }),
  EnvInfo,
]).annotate({ identifier: "Connection.Ref" })
export type Ref = typeof Ref.Type
