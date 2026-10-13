import { UsageReporter } from "@opencode/schema/usage-reporter"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { ConsoleForbiddenError } from "../console.js"

const error = [InvalidRequestError, ConsoleForbiddenError]
export const UsageReporterGroup = HttpApiGroup.make("server.usageReporter")
  .add(
    HttpApiEndpoint.get("usageReporter.snapshot", "/api/usage-reporter", {
      success: UsageReporter.Snapshot,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "usageReporter.snapshot" })),
  )
  .add(
    HttpApiEndpoint.put("usageReporter.configure", "/api/usage-reporter", {
      payload: UsageReporter.Configure,
      success: UsageReporter.Snapshot,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "usageReporter.configure" })),
  )
  .add(
    HttpApiEndpoint.post("usageReporter.flush", "/api/usage-reporter/flush", {
      success: UsageReporter.Snapshot,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "usageReporter.flush" })),
  )
  .add(
    HttpApiEndpoint.post("usageReporter.retry", "/api/usage-reporter/deliveries/:id/retry", {
      params: { id: Schema.String },
      query: { destination: Schema.optional(Schema.Literals(["original", "current"])) },
      success: UsageReporter.Snapshot,
      error,
    }).annotateMerge(OpenApi.annotations({ identifier: "usageReporter.retry" })),
  )
