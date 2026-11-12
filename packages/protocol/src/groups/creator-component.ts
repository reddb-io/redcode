import { CreatorComponent } from "@opencode/schema/creator-component"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, CreatorComponentNotFoundError, InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const errors = [ConflictError, CreatorComponentNotFoundError, InvalidRequestError, ConsoleForbiddenError]
const params = { componentID: CreatorComponent.ID }
export const CreatorComponentGroup = HttpApiGroup.make("server.creatorComponent")
  .add(
    HttpApiEndpoint.get("creator.component.list", "/api/creator/component", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CreatorComponent.Info)),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.list",
          summary: "List installed isolated Creator components in this project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.component.install", "/api/creator/component", {
      query: LocationQuery,
      payload: CreatorComponent.Install,
      success: Location.response(CreatorComponent.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.install",
          summary: "Install a published Design revision as an isolated project component",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.component.update", "/api/creator/component/:componentID", {
      params,
      query: LocationQuery,
      payload: CreatorComponent.Update,
      success: Location.response(CreatorComponent.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.update",
          summary: "Update an installed component without overwriting a newer version",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("creator.component.control", "/api/creator/component/:componentID/control", {
      params,
      query: LocationQuery,
      payload: CreatorComponent.Control,
      success: Location.response(CreatorComponent.Info),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.control",
          summary: "Enable or disable a Creator component",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("creator.component.remove", "/api/creator/component/:componentID", {
      params,
      query: LocationQuery,
      payload: CreatorComponent.Remove,
      success: HttpApiSchema.NoContent,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.remove",
          summary: "Remove installation metadata while preserving source artifacts",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("creator.component.preview", "/api/creator/component/:componentID/preview", {
      params,
      query: LocationQuery,
      success: Location.response(CreatorComponent.Preview),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "creator.component.preview",
          summary: "Read the pinned isolated HTML for an enabled Creator component",
        }),
      ),
  )
