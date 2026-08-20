import { Redskilled } from "@opencode-ai/schema/redskilled"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const RedskilledStatusQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Redskilled.Scope),
})

const root = "/redskilled"

export class RedskilledApiError extends Schema.ErrorClass<RedskilledApiError>("RedskilledError")(
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export const RedskilledApi = HttpApi.make("redskilled")
  .add(
    HttpApiGroup.make("redskilled")
      .add(
        HttpApiEndpoint.get("status", root, {
          query: RedskilledStatusQuery,
          success: described(Redskilled.Status, "Native redskilled integration status"),
          error: RedskilledApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "redskilled.status", summary: "Read redskilled status" })),
        HttpApiEndpoint.post("consent", `${root}/consent`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.ConsentInput,
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "redskilled.consent", summary: "Change the Project drain intent" }),
        ),
        HttpApiEndpoint.post("resize", `${root}/project/resize`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.ResizeInput,
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "redskilled.project.resize", summary: "Resize this project" }),
        ),
        HttpApiEndpoint.post("stopProject", `${root}/project/stop`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "redskilled.project.stop", summary: "Stop this project" })),
        HttpApiEndpoint.post("stopWorker", `${root}/worker/stop`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.WorkerInput,
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.stop", summary: "Stop a Worker" })),
        HttpApiEndpoint.post("recycleWorker", `${root}/worker/recycle`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.WorkerInput,
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.recycle", summary: "Recycle a Worker" })),
        HttpApiEndpoint.post("steerWorker", `${root}/worker/steer`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.SteerInput,
          success: Redskilled.Status,
          error: RedskilledApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "redskilled.worker.steer", summary: "Steer a Worker" })),
        HttpApiEndpoint.post("steerStatus", `${root}/worker/steer/status`, {
          query: Schema.Struct(WorkspaceRoutingQueryFields),
          payload: Redskilled.WorkerInput,
          success: Redskilled.SteerStatus,
          error: RedskilledApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "redskilled.worker.steerStatus",
            summary: "Report typed Worker steer status as unavailable over ACP core",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "redskilled", description: "Native RedDB Worker integration." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "redskilled", version: "1.0.0" }))
