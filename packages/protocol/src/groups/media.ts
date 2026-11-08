import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { FileNotFoundError, InvalidRequestError } from "../errors.js"

export const MediaHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)).annotate({
  identifier: "MediaHash",
})

export const MediaGetEndpoint = HttpApiEndpoint.get("media.get", "/api/experimental/media/:hash", {
  params: { hash: MediaHash },
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  error: [FileNotFoundError, InvalidRequestError],
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.media.get",
    summary: "Read media blob",
    description:
      "Read referenced content-addressed media by SHA-256 hash. Responses use immutable caching and never expose orphaned blobs.",
  }),
)
