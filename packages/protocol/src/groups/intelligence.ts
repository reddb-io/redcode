import { Intelligence } from "@opencode/schema/intelligence"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"

export const IntelligenceGroup = HttpApiGroup.make("server.intelligence")
  .add(
    HttpApiEndpoint.get("intelligence.status", "/api/experimental/intelligence", {
      success: Intelligence.Status,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.status",
        summary: "Get reasoning roles",
        description: "Show System Two, System One, and the effective single or dual reasoning mode.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("intelligence.save", "/api/experimental/intelligence", {
      payload: Intelligence.Save,
      success: Intelligence.Settings,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.save",
        summary: "Configure reasoning roles",
        description:
          "Select a System Two principal and optional System One evaluator. Store an evaluator key in the credential service when provided.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("intelligence.discover", "/api/experimental/intelligence/models", {
      payload: Intelligence.Probe,
      success: Intelligence.Models,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.discover",
        summary: "Discover System One models",
        description: "List evaluator models available from the selected transport.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("intelligence.probe", "/api/experimental/intelligence/probe", {
      payload: Intelligence.Probe,
      success: Intelligence.Check,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.probe",
        summary: "Test System One connection",
        description: "Check that the selected evaluator responds to a small typed evaluation request.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "intelligence", description: "System One and System Two setup." }))
