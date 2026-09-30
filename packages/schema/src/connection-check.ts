export * as ConnectionCheck from "./connection-check.js"

import { Option, Schema } from "effect"

export const Request = Schema.Struct({
  url: Schema.String,
  method: Schema.String,
  status: Schema.mutableKey(Schema.optional(Schema.Int)),
  durationMs: Schema.mutableKey(Schema.Number),
  bytes: Schema.mutableKey(Schema.Int),
  models: Schema.mutableKey(Schema.optional(Schema.Int)),
  failure: Schema.mutableKey(Schema.optional(Schema.Literals(["timeout", "network", "body"]))),
}).annotate({ identifier: "ConnectionCheck.Request" })
export type Request = typeof Request.Type

export const Report = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
  requests: Schema.Array(Request),
}).annotate({ identifier: "ConnectionCheck.Report" })
export type Report = typeof Report.Type

const decodeRequests = Schema.decodeUnknownOption(Schema.Struct({ requests: Schema.Array(Request) }))

export function requestsFrom(error: unknown, depth = 0): readonly Request[] {
  if (depth >= 5) return []
  const decoded = decodeRequests(error)
  if (Option.isSome(decoded)) return decoded.value.requests
  return typeof error === "object" && error !== null && "cause" in error ? requestsFrom(error.cause, depth + 1) : []
}

export function describe(requests: readonly Request[]) {
  if (!requests.length) return "No remote HTTP request was observed. API availability was not verified."
  return requests
    .map((request) =>
      [
        `${request.method} ${request.url}`,
        `${request.status === undefined ? "No HTTP response" : `HTTP ${request.status}`} · ${Math.round(request.durationMs)} ms · ${request.bytes.toLocaleString("en-US")} bytes${request.models === undefined ? "" : ` · ${request.models} models`}${request.failure ? ` · ${request.failure}` : ""}`,
      ].join("\n"),
    )
    .join("\n\n")
}
