import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const HealthResponse = Schema.Struct({ healthy: Schema.Literal(true) })

export const HealthGroup = HttpApiGroup.make("server.health").add(
  HttpApiEndpoint.get("health.get", "/api/health", {
    success: HealthResponse,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.health.get",
      summary: "Check server health",
      description: "Check whether the API server is ready to accept requests.",
    }),
  ),
)
