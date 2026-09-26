import { Location } from "@opencode/schema/location"
import { LSP } from "@opencode/schema/lsp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { InvalidRequestError } from "../errors.js"

const DiagnosticsQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: Schema.String,
})
const SymbolsQuery = Schema.Struct({
  ...LocationQuery.fields,
  query: Schema.String,
})

export const LSPGroup = HttpApiGroup.make("server.lsp")
  .add(
    HttpApiEndpoint.get("lsp.status", "/api/lsp", {
      query: LocationQuery,
      success: Location.response(Schema.Array(LSP.Status)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "lsp.status",
        summary: "Get LSP status",
        description: "List connected and failed language servers for this location.",
      })),
  )
  .add(
    HttpApiEndpoint.get("lsp.diagnostics", "/api/lsp/diagnostics", {
      query: DiagnosticsQuery,
      success: Location.response(Schema.Record(Schema.String, Schema.Array(LSP.Diagnostic))),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "lsp.diagnostics",
        summary: "Get LSP diagnostics",
        description: "Open a file and return language server diagnostics for the location.",
      })),
  )
  .add(
    HttpApiEndpoint.get("lsp.symbols", "/api/lsp/symbols", {
      query: SymbolsQuery,
      success: Location.response(Schema.Array(Schema.Unknown)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "lsp.symbols",
        summary: "Search workspace symbols",
        description: "Search symbols in connected language servers for this location.",
      })),
  )
  .add(
    HttpApiEndpoint.get("lsp.documentSymbols", "/api/lsp/document-symbols", {
      query: DiagnosticsQuery,
      success: Location.response(Schema.Array(Schema.Unknown)),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "lsp.documentSymbols",
        summary: "Get document symbols",
        description: "Get symbols from a file using connected language servers.",
      })),
  )
  .annotateMerge(OpenApi.annotations({ title: "lsp" }))
