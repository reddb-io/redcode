import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { Router } from "@opencode/schema/router"

/**
 * The connection and any reported hops, without changing the model ID sent to the provider. Cramped
 * spots such as the prompt footer pass `Router.HOP_SEPARATOR_COMPACT` for `RedRouter»Antigravity`.
 */
export function modelRoute(model: ModelInfo, provider: ProviderInfo | undefined, separator = Router.HOP_SEPARATOR) {
  const connection = provider?.name ?? model.providerID
  if (model.providerID !== "red-router" && model.providerID !== "9router") return connection
  const routed = Router.routeOf(model)
  const hops = model.via ? [model.via] : routed.hops.map(Router.hopName)
  const upstream = model.upstream?.name ?? (!model.flat ? routed.provider : undefined)
  return [connection, ...hops, upstream].filter((part): part is string => !!part).join(separator)
}

/** What a RedRouter connection's key may do, in words (`admin key`), from the provider's saved router connection. */
export function keyRoleLabel(provider: ProviderInfo | undefined) {
  return provider?.router?.role ? `${provider.router.role} key` : undefined
}

/** The key role of the provider an integration connected, for the integration's own rows. */
export function integrationKeyRole(providers: ProviderInfo[], integrationID: string) {
  return keyRoleLabel(
    providers.find(
      (provider) =>
        (provider.integrationID === integrationID || provider.id === integrationID) && provider.router?.role,
    ),
  )
}

export function modelDescription(model: ModelInfo, provider: ProviderInfo | undefined) {
  return [
    modelRoute(model, provider),
    model.id,
    ...(model.aliases?.length ? [`aliases: ${model.aliases.join(", ")}`] : []),
    ...(model.flat ? ["automatic route"] : []),
    ...(model.upstream?.subscription ? ["subscription"] : []),
  ].join(" · ")
}

export function modelLabel(model: ModelInfo, providers: ProviderInfo[]) {
  return `${modelRoute(
    model,
    providers.find((provider) => provider.id === model.providerID),
  )} · ${model.name} (${model.id})`
}

/**
 * Announces a background router catalog refresh, e.g. `RedRouter catalog updated: +2/−1 models, 3 renamed`,
 * or undefined when only limits or modes changed: the pickers already show those, nothing to announce.
 */
export function catalogUpdateMessage(update: { name: string; added: number; removed: number; renamed: number }) {
  if (!update.added && !update.removed && !update.renamed) return undefined
  const renamed = update.renamed > 0 ? `, ${update.renamed} renamed` : ""
  return `${update.name} catalog updated: +${update.added}/−${update.removed} models${renamed}`
}
