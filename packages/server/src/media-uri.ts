import type { HttpServerRequest } from "effect/unstable/http"

const CAPABILITIES_HEADER = "x-opencode-capabilities"
const MEDIA_URI_CAPABILITY = "experimental-media-uri"

/** True only when a client explicitly accepts content-addressed `media:` attachment references. */
export const wantsMediaRefs = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers[CAPABILITIES_HEADER]?.split(",").some(
    (token) => token.trim().toLowerCase() === MEDIA_URI_CAPABILITY,
  ) ?? false
