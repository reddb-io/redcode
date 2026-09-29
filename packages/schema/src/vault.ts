export * as Vault from "./vault.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { SessionID } from "./session-id.js"

/** A stored secret as every listing shows it: the name a reference uses and its kind, never its value. */
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  created: Schema.Finite,
}).annotate({ identifier: "Vault.Entry" })

/** The `metadata.vault` marker on a user message whose secrets were moved into the vault before it was stored. */
export const Moved = Schema.Array(Schema.Struct({ name: Schema.String, kind: Schema.String })).annotate({
  identifier: "Vault.Moved",
})
export type Moved = typeof Moved.Type

/** The text the model reads and writes in place of a stored value. */
export const reference = (name: string) => `{vault:${name}}`

/** Lists and forgets the secrets of a Session's project. No method returns a value. */
export const Definition = define({
  id: "redcode.vault",
  methods: {
    list: { input: Schema.Struct({ sessionID: SessionID }), output: Schema.Array(Entry) },
    forget: { input: Schema.Struct({ sessionID: SessionID, name: Schema.String }), output: Schema.Boolean },
  },
  events: {},
})
