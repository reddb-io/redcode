export * as Formatter from "./formatter.js"

import { Schema } from "effect"

export const Status = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "Formatter.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}
