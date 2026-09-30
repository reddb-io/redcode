export * as RemoteCheck from "./remote-check.js"

import { ConnectionCheck } from "@opencode/schema/connection-check"
import type { HttpMiddleware } from "@opencode/ai/route"
import { connectionFailure } from "@opencode/util/connection-failure"
import { Effect, Option } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

/** Report destinations without authentication, fragments or token-bearing query parameters. */
function destination(value: string) {
  const url = new URL(value)
  url.username = ""
  url.password = ""
  url.hash = ""
  Array.from(url.searchParams.keys())
    .filter((key) => !["capabilities", "limit", "after"].includes(key))
    .forEach((key) => url.searchParams.delete(key))
  return url.href
}

export async function request(url: string, init: RequestInit, requests?: ConnectionCheck.Request[]) {
  if (!requests) return fetch(url, init)
  const started = performance.now()
  const request: ConnectionCheck.Request = {
    url: destination(url),
    method: init.method ?? "GET",
    durationMs: 0,
    bytes: 0,
  }
  requests.push(request)
  const response = await fetch(url, init).catch((error: unknown) => {
    request.durationMs = performance.now() - started
    request.failure = connectionFailure(error).kind === "timeout" ? "timeout" : "network"
    throw error
  })
  request.status = response.status
  const bytes = await response
    .clone()
    .arrayBuffer()
    .catch((error: unknown) => {
      request.durationMs = performance.now() - started
      request.failure = "body"
      throw error
    })
  request.bytes = bytes.byteLength
  request.durationMs = performance.now() - started
  return response
}

/** Buffer only explicit, small connection probes; normal model execution keeps its streaming path. */
export function http(requests: ConnectionCheck.Request[]): HttpMiddleware {
  return (request, send) => {
    const started = performance.now()
    return Effect.gen(function* () {
      const observed: ConnectionCheck.Request = {
        url: destination(Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url)).href),
        method: request.method,
        durationMs: 0,
        bytes: 0,
      }
      requests.push(observed)
      const response = yield* send(request).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            observed.durationMs = performance.now() - started
            observed.failure = connectionFailure(error).kind === "timeout" ? "timeout" : "network"
          }),
        ),
      )
      observed.status = response.status
      const bytes = yield* response.arrayBuffer.pipe(
        Effect.mapError((error) => new Error(error.message)),
        Effect.tapError(() =>
          Effect.sync(() => {
            observed.durationMs = performance.now() - started
            observed.failure = "body"
          }),
        ),
      )
      observed.bytes = bytes.byteLength
      observed.durationMs = performance.now() - started
      return HttpClientResponse.fromWeb(
        request,
        new Response([204, 205, 304].includes(response.status) ? null : bytes, {
          status: response.status,
          headers: response.headers,
        }),
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const observed = requests[requests.length - 1]
          if (observed) observed.durationMs = performance.now() - started
        }),
      ),
    )
  }
}
