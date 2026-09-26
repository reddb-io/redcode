import { Location } from "@opencode/schema/location"
import { SessionGuard } from "@opencode/schema/session-guard"
import { NonNegativeInt, PositiveInt } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const DebugGroup = HttpApiGroup.make("server.debug")
  .add(
    HttpApiEndpoint.get("debug.guards", "/api/debug/guards", {
      query: Schema.Struct({
        since: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional),
        limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
      }),
      success: SessionGuard.Report,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "debug.guards",
        summary: "Inspect session guard interventions",
        description: "List recent guard interventions and their counts by guard and action.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("debug.location", "/api/debug/location", {
      success: Schema.Array(Location.PublicRef),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "debug.location.list",
        summary: "List loaded locations",
        description: "List locations currently loaded by the server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("debug.location.evict", "/api/debug/location", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "debug.location.evict",
          summary: "Evict a loaded location",
          description: "Dispose the requested location's cached services so its next use boots them fresh.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "debug" }))
