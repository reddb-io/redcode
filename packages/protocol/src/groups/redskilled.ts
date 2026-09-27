import { Location } from "@opencode/schema/location"
import { Redskilled } from "@opencode/schema/redskilled"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const StatusQuery = Schema.Struct({ ...LocationQuery.fields, scope: Schema.optional(Redskilled.Scope) })

export const RedskilledGroup = HttpApiGroup.make("server.redskilled")
  .add(
    HttpApiEndpoint.get("redskilled.status", "/api/redskilled", {
      query: StatusQuery,
      success: Location.response(Redskilled.Status),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.status", summary: "Read Redskilled status" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.consent", "/api/redskilled/consent", {
      query: LocationQuery,
      payload: Redskilled.ConsentInput,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.consent", summary: "Set project drain intent" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.project.resize", "/api/redskilled/project/resize", {
      query: LocationQuery,
      payload: Redskilled.ResizeInput,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.project.resize", summary: "Resize Redskilled project" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.project.stop", "/api/redskilled/project/stop", {
      query: LocationQuery,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.project.stop", summary: "Stop Redskilled project" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.worker.stop", "/api/redskilled/worker/stop", {
      query: LocationQuery,
      payload: Redskilled.WorkerInput,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.stop", summary: "Stop Redskilled worker" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.worker.recycle", "/api/redskilled/worker/recycle", {
      query: LocationQuery,
      payload: Redskilled.WorkerInput,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.recycle", summary: "Recycle Redskilled worker" })),
  )
  .add(
    HttpApiEndpoint.post("redskilled.worker.steer", "/api/redskilled/worker/steer", {
      query: LocationQuery,
      payload: Redskilled.SteerInput,
      success: Location.response(Redskilled.Status),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.steer", summary: "Steer Redskilled worker" })),
  )
  .add(
    HttpApiEndpoint.get("redskilled.worker.steerStatus", "/api/redskilled/worker/steer/status", {
      query: Schema.Struct({ ...LocationQuery.fields, worker: Schema.String }),
      success: Location.response(Redskilled.SteerStatus),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.steerStatus", summary: "Read worker steer status" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "redskilled" }))
