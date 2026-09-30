import { Model } from "@opencode/schema/model"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const GenerateGroup = HttpApiGroup.make("server.generate")
  .add(
    HttpApiEndpoint.post("generate.text", "/api/experimental/generate", {
      query: LocationQuery,
      payload: Schema.Struct({
        prompt: Schema.String,
        model: Model.Ref.pipe(Schema.optional),
        check: Schema.optional(Schema.Boolean),
      }),
      success: Schema.Struct({
        data: Schema.Struct({ text: Schema.String, requests: Schema.optional(Schema.Array(ConnectionCheck.Request)) }),
      }).annotate({ identifier: "GenerateTextResponse" }),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.generate.text",
          summary: "Generate text",
          description:
            "Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "generate",
      description: "Experimental one-shot generation routes.",
    }),
  )
