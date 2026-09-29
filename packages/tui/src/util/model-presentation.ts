import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { Router } from "@opencode/schema/router"

/** The connection and any reported hops, without changing the model ID sent to the provider. */
export function modelRoute(model: ModelInfo, provider: ProviderInfo | undefined) {
  const connection = provider?.name ?? model.providerID
  if (model.providerID !== "red-router" && model.providerID !== "9router") return connection
  const routed = Router.routeOf(model)
  const hops = model.via ? [model.via] : routed.hops.map(Router.hopName)
  const upstream = model.upstream?.name ?? (!model.flat ? routed.provider : undefined)
  return [connection, ...hops, upstream].filter((part): part is string => !!part).join(Router.HOP_SEPARATOR)
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
