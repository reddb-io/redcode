import { WorkerLease } from "@opencode/schema/worker-lease"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError } from "../errors.js"

export const WorkerLeaseGroup = HttpApiGroup.make("server.workerLease")
  .add(
    HttpApiEndpoint.post("workerLease.acquire", "/api/worker-lease/acquire", {
      payload: WorkerLease.Acquire,
      success: WorkerLease.Result,
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workerLease.acquire",
        summary: "Reserve an existing worker checkout for one original task",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workerLease.renew", "/api/worker-lease/renew", {
      payload: WorkerLease.Info,
      success: WorkerLease.Info,
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "workerLease.renew", summary: "Renew the current coordinator fence" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workerLease.release", "/api/worker-lease/release", {
      payload: WorkerLease.Info,
      success: HttpApiSchema.NoContent,
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workerLease.release",
        summary: "Release a checkout after its admitted work has stopped",
      }),
    ),
  )
