import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization.js"

export const RpcMaxBodyBytes = 1024 * 1024

export const LegacyRpcGroup = HttpApiGroup.make("server.legacy-rpc")
  .add(
    HttpApiEndpoint.post("legacy-rpc.handle", "/rpc", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "legacy-rpc.handle",
        summary: "Call a legacy Redcode RPC method",
        description: "Accepts JSON-RPC 2.0 or TOON-RPC 1.0 for health and Session reads.",
      }),
    ),
  )
  .middleware(Authorization)
  .annotateMerge(OpenApi.annotations({ title: "legacy-rpc" }))

export const LegacyRpcApi = HttpApi.make("legacy-rpc").add(LegacyRpcGroup)
