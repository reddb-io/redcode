import type { Model, Provider, RouterConnection } from "@reddb-io/redcode-sdk/v2/client"
import { Router } from "@reddb-io/redcode-schema/router"

type OriginProvider = Pick<Provider, "id" | "name" | "router">
type OriginModel = Pick<Model, "id" | "upstream" | "via" | "flat" | "offers"> & { provider: OriginProvider }
type Offer = NonNullable<Model["offers"]>[number]

export type ModelAlternatives = { direct: boolean; routers: string[] }

const routerNames = { "red-router": "RedRouter", "9router": "9Router" } satisfies Record<
  RouterConnection["kind"],
  string
>

export const modelKey = (model: { id: string; provider: { id: string } }) => `${model.provider.id}:${model.id}`

export function routerKind(provider: Pick<Provider, "id" | "router">) {
  if (provider.router) return provider.router.kind
  // Connections saved before routers were recorded on the provider only carry the RedRouter id.
  if (provider.id === "red-router") return "red-router" as const
  return undefined
}

export function routerName(provider: Pick<Provider, "id" | "router">) {
  const kind = routerKind(provider)
  return kind ? routerNames[kind] : undefined
}

/** Where a model comes from: a provider connected directly, or a router and the provider behind it. */
export function modelOrigin(model: OriginModel) {
  if (!routerKind(model.provider)) return { type: "direct" as const }
  return {
    type: "router" as const,
    router: model.provider.name,
    upstream: model.upstream?.name,
    subscription: model.upstream?.subscription === true,
    via: model.via,
  }
}

/** The router a model is reached through, naming the router in between (a remote RedRouter) too. */
export function routerPath(origin: { router: string; via?: string }) {
  return origin.via ? `${origin.router}${Router.HOP_SEPARATOR}${origin.via}` : origin.router
}

/**
 * What a router catalog refresh changed, when a model was added, removed or renamed. A refresh
 * that only changed limits or modes updates the pickers without an announcement.
 */
export function catalogUpdate(event: { type: string; properties?: unknown }) {
  if (event.type !== "provider.catalog.updated" || !isRecord(event.properties)) return undefined
  const value = event.properties
  const count = (key: string) => {
    const item = value[key]
    return typeof item === "number" ? item : 0
  }
  const update = {
    name: typeof value.name === "string" ? value.name : "Router",
    added: count("added"),
    removed: count("removed"),
    renamed: count("renamed"),
  }
  if (!update.added && !update.removed && !update.renamed) return undefined
  return update
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Routed models are grouped by the provider behind them, e.g. `RedRouter » OpenAI Codex`. */
export function modelGroup(model: OriginModel) {
  const upstream = routerKind(model.provider) ? model.upstream : undefined
  if (!upstream) return { key: model.provider.id, label: model.provider.name }
  return {
    key: `${model.provider.id}:${upstream.id}`,
    label: `${model.provider.name}${Router.HOP_SEPARATOR}${upstream.name}`,
  }
}

/**
 * Pairs models offered both directly and through a RedRouter, keyed by `modelKey`. A RedRouter model
 * matches a direct one when its upstream id or slug is the direct provider's id and its id after the
 * first `/` is the direct model's id. A flat model id names no provider, so each of its offers is
 * matched instead (an offer id is always chained).
 */
export function modelAlternatives(models: OriginModel[]) {
  const direct = new Map(models.filter((model) => !routerKind(model.provider)).map((model) => [modelKey(model), model]))
  const pairs = models.flatMap((routed) => {
    if (routerKind(routed.provider) !== "red-router") return []
    const slash = routed.id.indexOf("/")
    const routes = routed.flat
      ? (routed.offers ?? []).map((offer) => ({ upstream: offer.provider, modelID: Router.route(offer.id).model }))
      : routed.upstream && slash >= 0
        ? [{ upstream: routed.upstream, modelID: routed.id.slice(slash + 1) }]
        : []
    return routes.flatMap((route) =>
      [...new Set([route.upstream.id, route.upstream.slug])].flatMap((providerID) => {
        const match = providerID ? direct.get(`${providerID}:${route.modelID}`) : undefined
        return match ? [{ direct: match, routed }] : []
      }),
    )
  })
  return pairs.reduce((result, pair) => {
    const directKey = modelKey(pair.direct)
    result.set(directKey, {
      direct: false,
      routers: [...new Set([...(result.get(directKey)?.routers ?? []), pair.routed.provider.name])],
    })
    result.set(modelKey(pair.routed), { direct: true, routers: [] })
    return result
  }, new Map<string, ModelAlternatives>())
}

/**
 * The offers of a flat model, in the router's policy order: the route (the connection's router, the
 * routers in between and the provider, joined by ` » `), the price per million tokens, and the id to
 * save to pin the offer. That id is the offer's pin id, never the offer id, which can be the flat id
 * itself; undefined when the offer cannot be pinned or no model is listed under its pin id.
 */
export function flatOffers(
  model: Pick<Model, "flat" | "offers"> & { provider: OriginProvider },
  pinnable: (id: string) => boolean,
) {
  if (!model.flat) return []
  return (model.offers ?? []).map((offer) => ({
    offer,
    route: [routerName(model.provider), ...offer.via.map((hop) => hop.name), offer.provider.name]
      .filter(Boolean)
      .join(Router.HOP_SEPARATOR),
    price: offerPrice(offer),
    pin: offer.pinID && offer.available && pinnable(offer.pinID) ? offer.pinID : undefined,
  }))
}

function offerPrice(offer: Offer) {
  if (offer.price?.input === undefined && offer.price?.output === undefined) return undefined
  const dollars = (value: number | undefined) => (value === undefined ? "?" : `$${Number(value.toFixed(4))}`)
  return `${dollars(offer.price.input)}/${dollars(offer.price.output)}`
}
