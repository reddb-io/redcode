import { Option, Schema } from "effect"
import { Harness } from "@opencode/schema/harness"
import type { SessionInfo } from "@opencode/client/promise"

export const RESOURCE_KEY = "redcode.delivery"
export type DeliverySection = "overview" | "resources" | "skills" | "monitors" | "hooks" | "automations"

const PullRequest = Schema.String.check(
  Schema.makeFilter<string>((value) => (pullRequestURL(value) ? undefined : "Expected an HTTPS pull request URL")),
)
const Resources = Schema.Struct({
  version: Schema.Literal(1),
  pullRequests: Schema.Array(PullRequest),
  harnesses: Schema.Array(Schema.Struct({ runID: Schema.NonEmptyString, driver: Harness.Driver })),
})

export type ResourceChange =
  | { type: "add-pr"; url: string }
  | { type: "remove-pr"; url: string }
  | { type: "add-harness"; runID: string; driver: Harness.Driver }
  | { type: "remove-harness"; runID: string; driver: Harness.Driver }

/** Decode the extension's opaque annotation once; unknown versions remain read-only. */
export function deliveryResources(metadata: SessionInfo["metadata"]) {
  const value = metadata?.[RESOURCE_KEY]
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(Resources)(value))
  return {
    invalid: value !== undefined && !parsed,
    value: parsed ?? { version: 1 as const, pullRequests: [], harnesses: [] },
  }
}

export function changeResources(resources: typeof Resources.Type, change: ResourceChange): typeof Resources.Type {
  if (change.type === "add-pr")
    return { ...resources, pullRequests: [...new Set([...resources.pullRequests, change.url])] }
  if (change.type === "remove-pr")
    return { ...resources, pullRequests: resources.pullRequests.filter((url) => url !== change.url) }
  if (change.type === "remove-harness")
    return { ...resources, harnesses: resources.harnesses.filter((run) => run.runID !== change.runID) }
  if (resources.harnesses.some((run) => run.runID === change.runID)) return resources
  return { ...resources, harnesses: [...resources.harnesses, { runID: change.runID, driver: change.driver }] }
}

/** Canonical links retain repository and PR identity, dropping view-specific query/fragment data. */
export function pullRequestURL(value: string) {
  const url = URL.parse(value.trim())
  if (!url || url.protocol !== "https:" || url.username || url.password) return
  if (!/^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)) return
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`
}
