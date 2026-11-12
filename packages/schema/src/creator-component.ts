export * as CreatorComponent from "./creator-component.js"

import { Schema } from "effect"
import { Design } from "./design.js"
import { Session } from "./session.js"
import { ephemeral, inventory } from "./event.js"
import { optional, PositiveInt, statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isPattern(/^creator_[a-z0-9-]+$/)).pipe(
  Schema.brand("CreatorComponent.ID"),
  statics((schema) => ({ create: () => schema.make(`creator_${crypto.randomUUID()}`) })),
)
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.NonEmptyString,
  description: Schema.String.pipe(optional),
  sessionID: Session.ID,
  designID: Design.ID,
  revision: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  version: PositiveInt,
  created: Schema.Number,
  updated: Schema.Number,
}).annotate({ identifier: "CreatorComponent.Info" })

export interface Install extends Schema.Schema.Type<typeof Install> {}
export const Install = Schema.Struct({
  sessionID: Session.ID,
  designID: Design.ID,
  revision: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "CreatorComponent.Install" })

export interface Update extends Schema.Schema.Type<typeof Update> {}
export const Update = Schema.Struct({
  expectedVersion: PositiveInt,
  revision: Schema.NonEmptyString,
  name: Schema.NonEmptyString.pipe(optional),
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "CreatorComponent.Update" })

export interface Control extends Schema.Schema.Type<typeof Control> {}
export const Control = Schema.Struct({ expectedVersion: PositiveInt, enabled: Schema.Boolean }).annotate({
  identifier: "CreatorComponent.Control",
})

export interface Remove extends Schema.Schema.Type<typeof Remove> {}
export const Remove = Schema.Struct({ expectedVersion: PositiveInt }).annotate({
  identifier: "CreatorComponent.Remove",
})

export interface Preview extends Schema.Schema.Type<typeof Preview> {}
export const Preview = Schema.Struct({ html: Schema.String, revision: Schema.String, version: PositiveInt }).annotate({
  identifier: "CreatorComponent.Preview",
})

const Updated = ephemeral({ type: "creator.component.updated", schema: { componentID: ID } })
export const Event = { Updated, Definitions: inventory(Updated) }
