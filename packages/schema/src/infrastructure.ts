export * as Infrastructure from "./infrastructure.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
export const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.isPattern(/\S/))
export const Role = Schema.Literals(["admin", "user"])
export type Role = typeof Role.Type
export const Owner = Schema.Struct({ id: ID, name: Name, role: Role })
export interface Owner extends Schema.Schema.Type<typeof Owner> {}
export const Member = Schema.Struct({ accountID: ID, email: Schema.String, name: Name, role: Role })
export interface Member extends Schema.Schema.Type<typeof Member> {}
export const Resource = Schema.Struct({ id: ID, ownerID: ID, name: Name, url: optional(Schema.String) })
export interface Resource extends Schema.Schema.Type<typeof Resource> {}
export const Grant = Schema.Struct({
  id: ID,
  resourceID: ID,
  workspaceID: ID,
  organizationID: ID,
  directory: Schema.String.check(Schema.isMinLength(1)),
})
export interface Grant extends Schema.Schema.Type<typeof Grant> {}
export const Snapshot = Schema.Struct({
  owners: Schema.Array(Owner),
  resources: Schema.Array(Resource),
  grants: Schema.Array(Grant),
})
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Access = Schema.Struct({
  accountID: ID,
  ownerID: ID,
  resourceID: ID,
  ownerRole: optional(Role),
  workspaceID: optional(ID),
  organizationID: optional(ID),
  organizationRole: optional(Schema.Literals(["owner", "admin", "member"])),
  directories: Schema.Array(Schema.String),
})
export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Claim = Schema.Struct({ setupToken: Schema.String, name: Name })
export const GrantCreate = Schema.Struct({ workspaceID: ID, directory: Grant.fields.directory })
export const ResourceCreate = Schema.Struct({ name: Name, url: optional(Schema.String) })
