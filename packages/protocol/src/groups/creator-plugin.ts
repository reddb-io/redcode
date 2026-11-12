import { CreatorPlugin } from "@opencode/schema/creator-plugin"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, CreatorPluginNotFoundError, InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const error = [ConflictError, CreatorPluginNotFoundError, InvalidRequestError, ServiceUnavailableError]
const params = { pluginID: CreatorPlugin.ID }
export const CreatorPluginGroup = HttpApiGroup.make("server.creatorPlugin")
  .add(
    HttpApiEndpoint.get("creator.plugin.list", "/api/creator/plugin", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CreatorPlugin.Entry)),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.list",
          summary: "List project Creator plugins and their actual runtime state",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("creator.plugin.candidates", "/api/creator/plugin/candidates", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CreatorPlugin.Candidate)),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.candidates",
          summary: "Find published Creator server plugin packages in this project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.plugin.review", "/api/creator/plugin/review", {
      query: LocationQuery,
      payload: CreatorPlugin.Source,
      success: Location.response(CreatorPlugin.Review),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.review",
          summary: "Review a published package without executing it",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.plugin.install", "/api/creator/plugin", {
      query: LocationQuery,
      payload: CreatorPlugin.Source,
      success: Location.response(CreatorPlugin.Info),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.install",
          summary: "Pin a disabled project plugin from an immutable published revision",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.plugin.test", "/api/creator/plugin/:pluginID/test", {
      params,
      query: LocationQuery,
      payload: CreatorPlugin.Expected,
      success: Location.response(CreatorPlugin.Info),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.test",
          summary: "Test loading, SDK registration and teardown in a disposable process on this server",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.plugin.control", "/api/creator/plugin/:pluginID/control", {
      params,
      query: LocationQuery,
      payload: CreatorPlugin.Control,
      success: Location.response(CreatorPlugin.Info),
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.control",
          summary: "Activate or deactivate a tested Creator plugin using the shared runtime",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("creator.plugin.remove", "/api/creator/plugin/:pluginID", {
      params,
      query: LocationQuery,
      payload: CreatorPlugin.Expected,
      success: HttpApiSchema.NoContent,
      error,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.plugin.remove",
          summary: "Unload and remove an installed package, preserving its original Creator document",
        }),
      ),
  )
