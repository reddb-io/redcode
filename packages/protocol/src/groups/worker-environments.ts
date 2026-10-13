import { WorkerEnvironment } from "@opencode/schema/worker-environment"
import { Worker } from "@opencode/schema/worker"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

export const WorkerEnvironmentsGroup = HttpApiGroup.make("server.workerEnvironments")
  .add(HttpApiEndpoint.get("workerEnvironments.list", "/api/worker-environments", {
    success: WorkerEnvironment.Snapshot, error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.create", "/api/worker-environments", {
    payload: WorkerEnvironment.Create, success: WorkerEnvironment.Info, error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.build", "/api/worker-environments/image", {
    payload: Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)) }),
    success: Schema.Struct({ image: Schema.String }), error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.start", "/api/worker-environments/:id/start", {
    params: { id: Worker.Name }, success: WorkerEnvironment.Info, error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.register", "/api/worker-environments/:id/register", {
    params: { id: Worker.Name }, payload: Schema.Struct({ resourceID: Worker.Register.fields.resourceID }),
    success: Worker.Status, error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.stop", "/api/worker-environments/:id/stop", {
    params: { id: Worker.Name }, success: WorkerEnvironment.Info, error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.delete("workerEnvironments.remove", "/api/worker-environments/:id", {
    params: { id: Worker.Name }, query: { purge: Schema.Boolean }, success: Schema.Void,
    error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .add(HttpApiEndpoint.post("workerEnvironments.request", "/api/worker-environments/:id/request", {
    params: { id: Worker.Name }, payload: WorkerEnvironment.Request, success: WorkerEnvironment.Response,
    error: [InvalidRequestError, ConsoleForbiddenError],
  }))
  .annotateMerge(OpenApi.annotations({ title: "workerEnvironments" }))
