export * as ProviderRemoval from "./provider-removal.js"

import { Schema } from "effect"

export const Result = Schema.Struct({
  providerID: Schema.String,
  dryRun: Schema.Boolean,
  removed: Schema.Struct({
    credentials: Schema.Int,
    config: Schema.Boolean,
    references: Schema.Array(Schema.String),
    learnedLimits: Schema.Int,
    hidden: Schema.Boolean,
  }),
  configPath: Schema.String,
  referencingFiles: Schema.Array(Schema.String),
  envVariables: Schema.Array(Schema.String),
}).annotate({ identifier: "ProviderRemoval.Result" })
export type Result = typeof Result.Type

/** The integration whose saved key also registers the router's MCP server. */
const ROUTER_ID = "red-router"

/** One effect of a removal, in display order. Clients render each kind in their own language. */
export type Item =
  | { readonly kind: "credentials"; readonly count: number }
  | { readonly kind: "mcp" }
  | { readonly kind: "config"; readonly path: string }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "learnedLimits"; readonly count: number }
  | { readonly kind: "hidden"; readonly variables: readonly string[] }
  | { readonly kind: "referencingFile"; readonly path: string }

/** Lists what a preview says a removal will do, followed by the configuration it leaves behind. */
export function items(result: Result): Item[] {
  return [
    ...(result.removed.credentials ? [{ kind: "credentials" as const, count: result.removed.credentials }] : []),
    // The router MCP server exists only while a router key is saved, so removing the keys drops it too.
    ...(result.providerID === ROUTER_ID && result.removed.credentials ? [{ kind: "mcp" as const }] : []),
    ...(result.removed.config ? [{ kind: "config" as const, path: result.configPath }] : []),
    ...result.removed.references.map((name) => ({ kind: "reference" as const, name })),
    ...(result.removed.learnedLimits ? [{ kind: "learnedLimits" as const, count: result.removed.learnedLimits }] : []),
    ...(result.removed.hidden ? [{ kind: "hidden" as const, variables: result.envVariables }] : []),
    ...result.referencingFiles.map((path) => ({ kind: "referencingFile" as const, path })),
  ]
}

/** Whether a removal would change nothing; files that still reference the provider are left alone. */
export function empty(result: Result) {
  return (
    !result.removed.credentials &&
    !result.removed.config &&
    !result.removed.references.length &&
    !result.removed.learnedLimits &&
    !result.removed.hidden
  )
}

/** The English line for one removal effect. */
export function describe(item: Item) {
  if (item.kind === "credentials") return `${item.count} saved credential(s)`
  if (item.kind === "mcp") return "RedRouter MCP server registered by the saved key"
  if (item.kind === "config") return `Global provider configuration in ${item.path}`
  if (item.kind === "reference") return `Reference: ${item.name}`
  if (item.kind === "learnedLimits") return `${item.count} learned model limit(s)`
  if (item.kind === "hidden")
    return item.variables.length
      ? `Ambient provider will be hidden by policy (still set: ${item.variables.join(", ")})`
      : "Ambient provider will be hidden by policy"
  return `Other configuration still references this provider: ${item.path}`
}
