import { SessionID } from "@/session/schema"
import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const ModelSuggestionPaths = {
  resolve: "/session/:sessionID/model-suggestion",
} as const

export const ResolvePayload = Schema.Struct({
  trigger: ModelSuggestion.Trigger,
  choice: ModelSuggestion.Choice,
})

export const ModelSuggestionApi = HttpApi.make("modelSuggestion")
  .add(
    HttpApiGroup.make("modelSuggestion")
      .add(
        HttpApiEndpoint.post("resolve", ModelSuggestionPaths.resolve, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: ResolvePayload,
          success: described(Schema.Boolean, "Answered; false when the suggested model is no longer available"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "modelSuggestion.resolve",
            summary: "Answer a model suggestion",
            description:
              "Record the person's answer to a model suggestion. `switch` first asks the router whether the suggested model is still usable: `false` means it is not, and the client must not switch; otherwise the client sets the model itself. Either answer tells other clients the card is answered. `keep` also stops suggestions for that trigger in the session.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "modelSuggestion",
          description: "Suggestions of another RedRouter model or combo, applied only when the person accepts.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Redcode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
