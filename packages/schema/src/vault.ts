export * as Vault from "./vault.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { SessionID } from "./session-id.js"

/**
 * A stored secret as every listing shows it: the name a reference uses, its kind and the destinations it may be sent
 * to without asking, never its value. A destination is a host such as `api.github.com`, `cmd:<program>` for a local
 * command, `mcp:<server>` or `file:<path>`.
 */
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  created: Schema.Finite,
  hosts: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate({ identifier: "Vault.Entry" })

/**
 * The `metadata` of the form `vault_request` opens: which secret the agent asks for and why. Its one string field,
 * `FORM_FIELD`, takes the value; a client renders it masked, and the server never publishes or keeps the answer.
 */
export const FormRequest = Schema.Struct({
  kind: Schema.Literal("vault"),
  name: Schema.String,
  purpose: Schema.String,
}).annotate({ identifier: "Vault.FormRequest" })
export type FormRequest = typeof FormRequest.Type
export const FORM_KIND = "vault"
export const FORM_FIELD = "value"

/**
 * What `import` stored: the names, in file order, and how many lines it skipped; `unreadable` when the file could
 * not be read and nothing was stored. Never a value.
 */
export const Imported = Schema.Struct({
  names: Schema.Array(Schema.String),
  skipped: Schema.Finite,
  unreadable: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Vault.Imported" })
export type Imported = typeof Imported.Type

/** The `metadata.vault` marker on a user message whose secrets were moved into the vault before it was stored. */
export const Moved = Schema.Array(Schema.Struct({ name: Schema.String, kind: Schema.String })).annotate({
  identifier: "Vault.Moved",
})
export type Moved = typeof Moved.Type

/** The text the model reads and writes in place of a stored value. */
export const reference = (name: string) => `{vault:${name}}`

/**
 * `name` as a reference can carry it: lowercase letters, digits and single dashes, at most 64 characters, so
 * `GITHUB_TOKEN` becomes `github-token`. Empty when nothing usable is left.
 */
export const sanitize = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "")

/**
 * The `metadata.restricted` marker on a Session, by user message ID: `sensitive` when System One read the message as
 * carrying restricted content in prose, `withheld` once the user removed it from every later provider request.
 * Withheld supersedes sensitive and is never downgraded.
 */
export const Restricted = Schema.Record(Schema.String, Schema.Literals(["sensitive", "withheld"])).annotate({
  identifier: "Vault.Restricted",
})
export type Restricted = typeof Restricted.Type

/** What every later provider request carries in place of a withheld message. */
export const WITHHELD = "[message withheld: restricted content]"

/**
 * Lists, adds, imports and forgets the secrets of a project, and withholds a message. No method returns a value.
 * `set` and `import` act on the Session's project, or on the project of the location the call is routed to when no
 * Session is given, as from the CLI.
 */
export const Definition = define({
  id: "redcode.vault",
  methods: {
    list: { input: Schema.Struct({ sessionID: SessionID }), output: Schema.Array(Entry) },
    forget: { input: Schema.Struct({ sessionID: SessionID, name: Schema.String }), output: Schema.Boolean },
    /** Stores `value` under `name`, made reference-safe, replacing that name's value; returns the stored name. */
    set: {
      input: Schema.Struct({ sessionID: Schema.optionalKey(SessionID), name: Schema.String, value: Schema.String }),
      output: Schema.String,
    },
    /** Reads `NAME=value` lines from the `.env` file at `path`, resolved against the location, on the server. */
    import: {
      input: Schema.Struct({ sessionID: Schema.optionalKey(SessionID), path: Schema.String }),
      output: Imported,
    },
    /** Whether the user message was withheld now; false when it already was or is not a user message. */
    withhold: { input: Schema.Struct({ sessionID: SessionID, messageID: Schema.String }), output: Schema.Boolean },
  },
  events: {},
})
