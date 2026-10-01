import { Intelligence } from "@opencode/schema/intelligence"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"

export const IntelligenceGroup = HttpApiGroup.make("server.intelligence")
  .add(
    HttpApiEndpoint.get("intelligence.artifacts", "/api/experimental/intelligence/artifacts", {
      query: { sessionID: Session.ID },
      success: Schema.Array(Intelligence.Artifact),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.artifacts",
        summary: "Inspect curation and learning",
        description: "List audit manifests and reviewable learning candidates for this Session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("intelligence.reviewLearning", "/api/experimental/intelligence/learning/:id", {
      params: { id: Schema.String },
      query: { sessionID: Session.ID },
      payload: Intelligence.LearningReview,
      success: Intelligence.Artifact,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.reviewLearning",
        summary: "Review a learning candidate",
        description: "Approve for export or reject a proposal. This never installs memories or skills.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("intelligence.sessionMode", "/api/experimental/intelligence/session/:sessionID", {
      params: { sessionID: Session.ID },
      payload: Intelligence.SessionMode,
      success: Intelligence.Settings,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.sessionMode",
        summary: "Set session reasoning",
        description: "Override the reasoning mode for this Session; null restores the service default.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("intelligence.evidence", "/api/experimental/intelligence/evidence/:id", {
      params: { id: Schema.String },
      query: { sessionID: Session.ID },
      success: Schema.Json,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.evidence",
        summary: "Inspect evaluation evidence",
        description:
          "Read the exact sources, candidate and versioned rubric of a persisted evaluation in this Session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("intelligence.history", "/api/experimental/intelligence/history", {
      query: {
        sessionID: Session.ID,
        limit: Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
          Schema.optional,
        ),
      },
      success: Schema.Array(Intelligence.Evaluation),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.history",
        summary: "Read session evaluations",
        description: "Read the most recent persisted System One evaluations for a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("intelligence.status", "/api/experimental/intelligence", {
      query: { sessionID: Session.ID.pipe(Schema.optional) },
      success: Intelligence.Status,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.intelligence.status",
        summary: "Get reasoning roles",
        description: "Show System Two, System One, and the effective single, dual or observation mode.",
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
