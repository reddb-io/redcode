import { Location } from "@opencode/schema/location"
import { FileSystem } from "@opencode/schema/filesystem"
import { Session } from "@opencode/schema/session"
import { SessionGuard } from "@opencode/schema/session-guard"
import { NonNegativeInt, PositiveInt } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const DebugGroup = HttpApiGroup.make("server.debug")
  .add(
    HttpApiEndpoint.get("debug.rg.files", "/api/debug/rg/files", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        glob: Schema.optional(Schema.String),
        query: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt))),
      }),
      success: Schema.Array(FileSystem.Entry),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "debug.rg.files",
        summary: "List files using ripgrep",
      })),
  )
  .add(
    HttpApiEndpoint.get("debug.rg.search", "/api/debug/rg/search", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        pattern: Schema.String,
        glob: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt))),
      }),
      success: Schema.Array(FileSystem.Match),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "debug.rg.search",
        summary: "Search file contents using ripgrep",
      })),
  )
  .add(
    HttpApiEndpoint.get("debug.todos", "/api/debug/todos", {
      query: Schema.Struct({ sessionID: Session.ID }),
      success: Schema.Struct({
        sessionID: Session.ID,
        tasks: Schema.Array(Schema.Struct({
          id: Schema.String,
          status: Schema.String,
          priority: Schema.String,
          content: Schema.String,
          revision: Schema.optional(Schema.Number),
          source: Schema.optional(Schema.Struct({
            type: Schema.String,
            messageID: Schema.String,
            quote: Schema.String,
            paraphrase: Schema.optional(Schema.String),
          })),
          criterion: Schema.optional(Schema.String),
          evidence: Schema.optional(Schema.String),
          reason: Schema.optional(Schema.String),
          scopeChange: Schema.optional(Schema.Struct({
            messageID: Schema.String,
            quote: Schema.String,
            paraphrase: Schema.optional(Schema.String),
          })),
          refusals: Schema.Number,
        })),
        errors: Schema.Array(Schema.Struct({
          time: Schema.String,
          kind: Schema.String,
          message: Schema.String,
          callID: Schema.String,
        })),
      }),
    }).annotateMerge(OpenApi.annotations({
      identifier: "debug.todos",
      summary: "Inspect session tasks and refused updates",
    })),
  )
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
