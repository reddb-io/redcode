export * as ConfigPolicy from "./policy.js"

import { Schema } from "effect"

export const Effect = Schema.Literals(["allow", "deny"])
export type Effect = typeof Effect.Type

export const Info = Schema.Struct({
  action: Schema.Literals(["provider.use", "permission"]),
  resource: Schema.String,
  effect: Effect,
  /** Marks a reversible deny added by provider removal, separate from user-authored policy. */
  source: Schema.Literal("provider-removal").pipe(Schema.optional),
})
export type Info = typeof Info.Type
