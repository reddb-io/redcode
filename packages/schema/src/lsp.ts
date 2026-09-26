export * as LSP from "./lsp.js"

import { Schema } from "effect"

export const Status = Schema.Struct({
  id: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "LSP.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

const Position = Schema.Struct({ line: Schema.Number, character: Schema.Number })
const Range = Schema.Struct({ start: Position, end: Position })

export const Diagnostic = Schema.Struct({
  range: Range,
  message: Schema.String,
  severity: Schema.optional(Schema.Number),
  code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  codeDescription: Schema.optional(Schema.Struct({ href: Schema.String })),
  source: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.Number)),
  relatedInformation: Schema.optional(Schema.Array(Schema.Struct({
    location: Schema.Struct({ uri: Schema.String, range: Range }),
    message: Schema.String,
  }))),
  data: Schema.optional(Schema.Unknown),
}).annotate({ identifier: "LSP.Diagnostic" })
export interface Diagnostic extends Schema.Schema.Type<typeof Diagnostic> {}
