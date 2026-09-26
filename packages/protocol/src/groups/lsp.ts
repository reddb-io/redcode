import { Location } from "@opencode/schema/location"
import { LSP } from "@opencode/schema/lsp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

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
  .annotateMerge(OpenApi.annotations({ title: "lsp" }))
