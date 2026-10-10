import { Worker } from "@opencode/schema/worker"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

export const WorkersGroup = HttpApiGroup.make("server.workers")
  .add(
    HttpApiEndpoint.get("workers.list", "/api/workers", {
      success: Worker.Snapshot,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "workers.list", summary: "Read coordinator workers and batches" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workers.add", "/api/workers", {
      payload: Worker.Register,
      success: Worker.Status,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(OpenApi.annotations({ identifier: "workers.add", summary: "Register an authenticated worker" })),
  )
  .add(
    HttpApiEndpoint.delete("workers.remove", "/api/workers/:id", {
      params: { id: Worker.Name },
      success: Schema.Void,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(OpenApi.annotations({ identifier: "workers.remove", summary: "Remove an idle worker" })),
  )
  .add(
    HttpApiEndpoint.post("workers.probe", "/api/workers/:id/probe", {
      params: { id: Worker.Name },
      success: Worker.Status,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "workers.probe", summary: "Check the registered worker connection" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workers.submit", "/api/workers/batches", {
      payload: Worker.Manifest,
      success: Worker.Batch,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(OpenApi.annotations({ identifier: "workers.submit", summary: "Submit a persistent batch" })),
  )
  .add(
    HttpApiEndpoint.post("workers.recover", "/api/workers/batches/:id/recover", {
      params: { id: Worker.Name },
      payload: Schema.Struct({ task: Worker.Name }),
      success: Worker.Batch,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "workers.recover", summary: "Recover the original worker admission" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workers.collect", "/api/workers/batches/:id/collect", {
      params: { id: Worker.Name },
      payload: Schema.Struct({ task: Worker.Name }),
      success: Worker.Artifact,
      error: [InvalidRequestError, ConsoleForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "workers.collect", summary: "Collect recorded task changes for review" }),
    ),
  )
