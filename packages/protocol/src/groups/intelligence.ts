import { Model } from "@reddb-io/redcode-schema/model"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

export const IntelligenceGroup = HttpApiGroup.make("server.intelligence")
  .add(
    HttpApiEndpoint.get("intelligence.get", "/api/intelligence", {
      success: Intelligence.Status,
      error: InvalidRequestError,
    }).annotateMerge(OpenApi.annotations({ identifier: "intelligence.get", summary: "Get global intelligence setup" })),
  )
  .add(
    HttpApiEndpoint.put("intelligence.save", "/api/intelligence", {
      payload: Intelligence.Save,
      success: Intelligence.Settings,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "intelligence.save", summary: "Save global intelligence setup" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("intelligence.discover", "/api/intelligence/models", {
      payload: Intelligence.Probe,
      success: Intelligence.Models,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "intelligence.discover", summary: "Discover System One models" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("intelligence.probe", "/api/intelligence/test", {
      payload: Intelligence.Probe,
      success: Intelligence.Check,
      error: InvalidRequestError,
    }).annotateMerge(OpenApi.annotations({ identifier: "intelligence.probe", summary: "Test System One connection" })),
  )
  .add(
    HttpApiEndpoint.get("intelligence.history", "/api/intelligence/evaluations", {
      query: Schema.Struct({ sessionID: Schema.String }),
      success: Schema.Array(Intelligence.Evaluation),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({ identifier: "intelligence.history", summary: "Read session semantic evaluations" }),
    ),
  )

export const IntelligenceModelGroup = HttpApiGroup.make("server.intelligence.model").add(
  HttpApiEndpoint.post("intelligence.model.test", "/api/intelligence/test-model", {
    payload: Model.Ref,
    success: Intelligence.Check,
    error: InvalidRequestError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "intelligence.model.test",
      summary: "Test a generative role with a synthetic prompt",
    }),
  ),
)
