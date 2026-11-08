export * as SessionOrigin from "./session-origin.js"

import { Schema } from "effect"
import { ClientPresence } from "./client-presence.js"
import { optional } from "./schema.js"

/** Reserved Session metadata key. The server preserves the first value for the Session lifetime. */
export const MetadataKey = "redcode.origin"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  surface: ClientPresence.Surface,
  clientID: Schema.String.pipe(optional),
  version: Schema.String.pipe(optional),
  createdAt: Schema.Finite,
}).annotate({ identifier: "Session.Origin" })
