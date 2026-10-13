import { Harness } from "@opencode/schema/harness"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

const error = [InvalidRequestError, ConsoleForbiddenError]
const run = { runID: Schema.String }
export const HarnessGroup = HttpApiGroup.make("server.harness")
  .add(
    HttpApiEndpoint.post("harness.reconcile", "/api/harness/runs/:runID/reconcile", {
      params: run,
      success: Harness.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.reconcile" })),
  )
  .add(
    HttpApiEndpoint.post("harness.install", "/api/harness/:driver/install", {
      params: { driver: Harness.Driver },
      success: Harness.Provider,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.install" })),
  )
  .add(
    HttpApiEndpoint.post("harness.loginAnswer", "/api/harness/:driver/login/answer", {
      params: { driver: Harness.Driver },
      payload: Schema.Struct({ code: Schema.NonEmptyString.check(Schema.isPattern(/^[^\r\n]+$/)) }),
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.loginAnswer" })),
  )
  .add(
    HttpApiEndpoint.delete("harness.cancelLogin", "/api/harness/:driver/login", {
      params: { driver: Harness.Driver },
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.cancelLogin" })),
  )
  .add(
    HttpApiEndpoint.get("harness.list", "/api/harness", { success: Harness.Snapshot, error }).annotateMerge(
      OpenApi.annotations({ identifier: "harness.list" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("harness.configure", "/api/harness/config", {
      payload: Harness.Config,
      success: Harness.Provider,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.configure" })),
  )
  .add(
    HttpApiEndpoint.post("harness.probe", "/api/harness/:driver/probe", {
      params: { driver: Harness.Driver },
      success: Harness.Provider,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.probe" })),
  )
  .add(
    HttpApiEndpoint.post("harness.login", "/api/harness/:driver/login", {
      params: { driver: Harness.Driver },
      success: Harness.Login,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.login" })),
  )
  .add(
    HttpApiEndpoint.get("harness.loginStatus", "/api/harness/:driver/login", {
      params: { driver: Harness.Driver },
      success: Harness.Login,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.loginStatus" })),
  )
  .add(
    HttpApiEndpoint.post("harness.open", "/api/harness/runs", {
      payload: Harness.Open,
      success: Harness.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.open" })),
  )
  .add(
    HttpApiEndpoint.get("harness.read", "/api/harness/runs/:runID", {
      params: run,
      success: Harness.Detail,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.read" })),
  )
  .add(
    HttpApiEndpoint.post("harness.prompt", "/api/harness/runs/:runID/prompt", {
      params: run,
      payload: Harness.Prompt,
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.prompt" })),
  )
  .add(
    HttpApiEndpoint.post("harness.answer", "/api/harness/runs/:runID/answer", {
      params: run,
      payload: Harness.Answer,
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.answer" })),
  )
  .add(
    HttpApiEndpoint.post("harness.interrupt", "/api/harness/runs/:runID/interrupt", {
      params: run,
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.interrupt" })),
  )
  .add(
    HttpApiEndpoint.post("harness.resume", "/api/harness/runs/:runID/resume", {
      params: run,
      success: Harness.Run,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.resume" })),
  )
  .add(
    HttpApiEndpoint.delete("harness.close", "/api/harness/runs/:runID", {
      params: run,
      success: Schema.Void,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "harness.close" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "harness",
      description: "Host-owned external coding agents. Requires infrastructure administration.",
    }),
  )
