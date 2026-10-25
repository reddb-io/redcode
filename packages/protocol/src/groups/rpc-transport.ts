import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization.js"

export const RpcMaxBodyBytes = 1024 * 1024

export const RpcTransportGroup = HttpApiGroup.make("server.rpc-transport")
  .add(
    HttpApiEndpoint.post("rpc-transport.handle", "/rpc", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "rpc-transport.handle",
        summary: "Call a Redcode RPC method",
        description: "Accepts JSON-RPC 2.0 or TOON-RPC 1.0 for health and Session reads.",
      }),
    ),
  )
  .middleware(Authorization)
  .annotateMerge(OpenApi.annotations({ title: "rpc" }))

export const RpcTransportApi = HttpApi.make("rpc").add(RpcTransportGroup)
