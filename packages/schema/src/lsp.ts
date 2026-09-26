export * as LSP from "./lsp.js"

import { Schema } from "effect"

export const Status = Schema.Struct({
  id: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "LSP.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}
