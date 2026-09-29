export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
  /** The provider a failed model request went to, so a wrong host, key or model can be told apart. */
  provider: Schema.String.pipe(optional),
  /** The model a failed model request asked for. */
  model: Schema.String.pipe(optional),
  /** The failed request's URL without credentials, query string or fragment. */
  url: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
