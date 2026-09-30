import type { ModelsDev } from "../../models-dev.js"

export type CatalogLimits = ReadonlyMap<string, { readonly context: number; readonly output: number }>

/**
 * The context and output limits the models catalog knows, by model id. The first provider that lists an id with a
 * known context wins.
 */
export function catalogLimits(catalog: readonly ModelsDev.Snapshot[]): CatalogLimits {
  return new Map(
    catalog
      .flatMap((item) => item.models)
      .filter((model) => model.limit.context > 0)
      .map((model) => [String(model.id), { context: model.limit.context, output: model.limit.output }] as const)
      .toReversed(),
  )
}

/**
 * What the catalog knows about a model an endpoint lists, though the endpoint did not describe it. Gateways and routers
 * prefix upstream ids (`openai/gpt-4o`, `cc/claude-sonnet`), so leading segments are dropped until the catalog knows one.
 */
export function knownLimit(limits: CatalogLimits, id: string) {
  return id
    .split("/")
    .map((_, start, parts) => limits.get(parts.slice(start).join("/")))
    .find((entry) => entry !== undefined)
}
