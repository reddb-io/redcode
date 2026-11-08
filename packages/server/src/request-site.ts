export * as RequestSite from "./request-site"

import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { type CorsOptions, isAllowedRequestOrigin } from "./cors"

const ARTIFACT_VIEW = /^\/api\/experimental\/artifacts\/[^/]+\/view(\/|$)/

export function rejected(request: HttpServerRequest.HttpServerRequest, options?: CorsOptions) {
  const site = request.headers["sec-fetch-site"]
  if (site !== "cross-site" && site !== "same-site") return false
  const pathname = new URL(request.url, "http://localhost").pathname
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return false
  if (ARTIFACT_VIEW.test(pathname)) return false
  if (request.headers["sec-fetch-mode"] === "navigate") return true
  const origin = request.headers.origin
  return origin !== undefined && !isAllowedRequestOrigin(origin, request.headers.host, options)
}

export const middleware = (options?: CorsOptions) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (!rejected(request, options)) return yield* app
      return HttpServerResponse.jsonUnsafe(
        { _tag: "ForbiddenError", message: "Cross-site requests to the API are not allowed" },
        { status: 403 },
      )
    }),
  )
