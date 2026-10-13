export * as Attention from "./attention.js"

import { Schema } from "effect"
import { Form } from "./form.js"
import { Permission } from "./permission.js"
import { Session } from "./session.js"
import { Location } from "./location.js"

/** Requests still owned by a live Session, without loading its transcript or booting a Location. */
export const Entry = Schema.Struct({
  session: Session.Info,
  permissions: Schema.Array(Permission.Request),
  forms: Schema.Array(Form.Info),
}).annotate({ identifier: "Attention.Entry" })
export interface Entry extends Schema.Schema.Type<typeof Entry> {}

export const Snapshot = Schema.Struct({
  data: Schema.Array(Entry),
  /** Cached Locations that could not be inspected; an incomplete inbox is not an empty inbox. */
  unavailable: Schema.Array(Location.Ref),
}).annotate({ identifier: "Attention.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
