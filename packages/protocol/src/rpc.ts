import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ActiveSessionsResponse, SessionListInput, SessionsResponse } from "./groups/session"
import { HealthResponse } from "./groups/health"
import { Authorization } from "./middleware/authorization"

export const RpcPath = "/rpc"
export const RpcMaxBodyBytes = 1024 * 1024
export const RpcContentTypes = ["application/json", "application/toon"] as const
export const RpcSupportsBatch = false
export const RpcNoParams = Schema.Union([Schema.Tuple([]), Schema.Struct({})])

export const RpcMethods = {
  healthGet: { name: "health.get", params: RpcNoParams, result: HealthResponse },
  sessionList: { name: "session.list", params: SessionListInput, result: SessionsResponse },
  sessionActive: { name: "session.active", params: RpcNoParams, result: ActiveSessionsResponse },
} as const

export const RpcGroup = HttpApiGroup.make("rpc")
  .add(
    HttpApiEndpoint.post("handle", RpcPath, {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
    }),
  )
  .middleware(Authorization)

export const RpcApi = HttpApi.make("rpc").add(RpcGroup)
