import type { Message, Model, Part, Provider } from "@reddb-io/redcode-sdk/v2"
import { Router } from "@reddb-io/redcode-schema/router"
import { parse } from "./model"

type ModelRef = { providerID: string; modelID: string }

/** The router a provider connection goes through, or undefined for a provider connected directly. */
export function routerLabel(provider: Pick<Provider, "id" | "router">) {
  // Configs saved before connections recorded their router only have the RedRouter provider id.
  const kind = provider.router?.kind ?? (provider.id === "red-router" ? "red-router" : undefined)
  if (kind === "red-router") return "RedRouter"
  if (kind === "9router") return "9Router"
  return undefined
}

/** Finds, for every model, the other connections that serve the same upstream model. */
export function originIndex(providers: Provider[]) {
  const routed = new Map<string, string[]>()
  providers.forEach((provider) => {
    const label = routerLabel(provider)
    if (!label) return
    Object.values(provider.models).forEach((model) => {
      upstreamKeys(model).forEach((key) => {
        const labels = routed.get(key) ?? []
        if (!labels.includes(label)) routed.set(key, [...labels, label])
      })
    })
  })
  const direct = new Set(
    providers
      .filter((provider) => !routerLabel(provider))
      .flatMap((provider) => Object.keys(provider.models).map((modelID) => `${provider.id}/${modelID}`)),
  )
  return {
    /** Labels of the other connections serving this model, e.g. ["RedRouter"] or ["direct"]. */
    also(provider: Provider, model: Model) {
      if (!routerLabel(provider)) return routed.get(`${provider.id}/${model.id}`) ?? []
      return upstreamKeys(model).some((key) => direct.has(key)) ? ["direct"] : []
    },
  }
}

export type OriginIndex = ReturnType<typeof originIndex>

/**
 * The connection a model is served through: `via RedRouter[ » RedRouter]`, or `direct`. Shown as a
 * title suffix when another catalog entry renders with the same name, so two entries reachable
 * through different router chains (e.g. one direct via RedRouter, one via a remote RedRouter) stay
 * distinguishable even when the row is filtered or truncated before the description is reached.
 * `originIndex.also` only tracks distinct router *labels*, so it does not by itself catch two
 * entries served by the same router through a different chain; callers decide when names collide.
 */
export function routeLabel(provider: Provider, model: Model) {
  const router = routerLabel(provider)
  if (!router) return "direct"
  // A router serving the model through other routers (remote RedRouters) names them too: the one it
  // reported, else every router hop in the model id, at any depth. A flat id names no route; its
  // serving offer's id does.
  const hops = model.via ? [model.via] : Router.routeOf(model).hops.map(Router.hopName)
  return `via ${[router, ...hops].join(Router.HOP_SEPARATOR)}`
}

/**
 * A model named with its whole route, the routers and upstream joined by ` » `: `RedRouter » Anthropic
 * · Claude Sonnet 4.5`. A model connected directly is its name alone.
 */
export function routedName(provider: Provider, model: Model) {
  const router = routerLabel(provider)
  const hops = model.via ? [model.via] : Router.routeOf(model).hops.map(Router.hopName)
  return Router.routeName({
    routers: router ? [router, ...hops] : [],
    upstream: router ? model.upstream?.name : undefined,
    model: model.name,
  })
}

/** The parts of `originDescription` after the route: upstream name, subscription, and duplicate connections. */
function originDetails(index: OriginIndex, provider: Provider, model: Model) {
  const router = routerLabel(provider)
  const also = index.also(provider, model)
  if (!router) return also.length ? [`also via ${also.join(", ")}`] : []
  const offers = model.flat ? (model.offers?.length ?? 0) : 0
  return [
    ...(model.upstream ? [model.upstream.name] : []),
    ...(model.upstream?.subscription ? ["subscription"] : []),
    ...(offers > 1 ? [`${offers} offers`] : []),
    ...(model.flat && model.offerOrder === "custom" ? ["custom order"] : []),
    ...(also.length ? [`also ${also.join(", ")}`] : []),
  ]
}

/** Where a model comes from: `direct`, or `via RedRouter » OpenAI Codex · subscription`, plus duplicates. */
export function originDescription(index: OriginIndex, provider: Provider, model: Model) {
  const route = routeLabel(provider, model)
  const details = originDetails(index, provider, model)
  // The upstream name continues the route (a hop), so it joins with the same separator as the router
  // chain; everything after it is a detail, not a hop, and keeps the plain separator.
  if (!routerLabel(provider) || !model.upstream) return [route, ...details].join(" · ")
  const [upstream, ...rest] = details
  return [`${route}${Router.HOP_SEPARATOR}${upstream}`, ...rest].join(" · ")
}

/**
 * `originDescription` without its `via <router>` (or `direct`) route, for callers that already show
 * the route elsewhere (e.g. as a title suffix) and would otherwise repeat it.
 */
export function originDescriptionDetail(index: OriginIndex, provider: Provider, model: Model) {
  return originDetails(index, provider, model).join(" · ")
}

/** Routed models are grouped per upstream provider inside their router connection. */
export function originCategory(provider: Provider, model: Model) {
  if (!routerLabel(provider) || !model.upstream) return provider.name
  return `${provider.name}${Router.HOP_SEPARATOR}${model.upstream.name}`
}

type Offer = NonNullable<Model["offers"]>[number]

/**
 * The offers of a flat model as picker rows, in the router's order: the route (the connection's
 * router, the routers in between and the provider, joined by ` » `), the price, `off` for an offer
 * switched off for the flat model (`offer.free` is the free badge), and the model to save to pin
 * the offer. That model is the one listed under the offer's pin id, never the offer id: the
 * vendor's own offer id can be the flat id itself. Undefined `pin` means the offer cannot be pinned.
 * An offer that is off is never served for the flat id, but its pin id still routes to it, so it
 * stays pinnable (`off` tells a picker to grey it out).
 */
export function flatOffers(provider: Provider, model: Model) {
  if (!model.flat) return []
  return (model.offers ?? []).map((offer) => ({
    offer,
    route: offerRoute(provider, offer),
    off: !offer.available,
    detail: [
      ...(offer.available ? [] : ["off"]),
      offerPrice(offer),
      ...(offer.pinID ? [] : ["cannot be pinned"]),
    ]
      .filter(Boolean)
      .join(" · "),
    pin: offer.pinID && provider.models[offer.pinID] ? offer.pinID : undefined,
  }))
}

/** Where an offer is served: `RedRouter » OpenRouter`, or `RedRouter » Office RedRouter » OpenCode Go`. */
export function offerRoute(provider: Pick<Provider, "id" | "router">, offer: Offer) {
  return [routerLabel(provider), ...offer.via.map((hop) => hop.name), offer.provider.name]
    .filter(Boolean)
    .join(Router.HOP_SEPARATOR)
}

/** An offer's price per million tokens, e.g. `$3/$15 per 1M`, or undefined when unknown. */
export function offerPrice(offer: Pick<Offer, "price">) {
  if (offer.price?.input === undefined && offer.price?.output === undefined) return undefined
  const dollars = (value: number | undefined) => (value === undefined ? "?" : `$${Number(value.toFixed(4))}`)
  return `${dollars(offer.price.input)}/${dollars(offer.price.output)} per 1M`
}

/**
 * The model a router reported serving a flat model's response, in words. The reported id is the
 * serving offer's full chained id, so it parses as a route; the offer's own names win when listed.
 */
export function servedRoute(model: Pick<Model, "offers"> | undefined, served: string) {
  const routed = Router.route(served)
  const offer = model?.offers?.find((item) => item.id === served)
  return Router.routeName({
    routers: offer ? offer.via.map((hop) => hop.name) : routed.hops.map(Router.hopName),
    upstream: offer?.provider.name ?? routed.provider,
    model: routed.model,
  })
}

/** Modes a router serves the model in besides its default, shown as a badge. */
export function modeBadge(model: Pick<Model, "modes">) {
  if (!model.modes?.length) return undefined
  return model.modes.join(" · ")
}

/**
 * The id a router serves one of the model's modes under (e.g. review) when that mode is chosen as
 * the variant, `<model>-<mode>` when the router listed the mode without one. Undefined for a
 * reasoning level.
 */
export function modeID(model: Pick<Model, "api" | "modes" | "routerVariants">, variant: string) {
  if (!model.modes?.includes(variant)) return undefined
  return model.routerVariants?.find((item) => item.mode === variant)?.id ?? `${model.api.id}-${variant}`
}

/**
 * Why a saved model choice is not used: its provider no longer lists it (RedRouter drops a flat
 * model id once all its offers are switched off) or is not connected, and the model used instead.
 */
export function missingModelMessage(providers: Provider[], saved: ModelRef, fallback: ModelRef | undefined) {
  const provider = providers.find((item) => item.id === saved.providerID)
  const reason = !provider
    ? `${saved.providerID} is not connected, so ${saved.modelID} is unavailable`
    : routerLabel(provider)
      ? `${provider.name} no longer lists ${saved.modelID}: it was removed, or all its offers were switched off`
      : `${provider.name} no longer lists ${saved.modelID}`
  const using = fallback ? ` Using ${fallback.providerID}/${fallback.modelID} instead.` : ""
  return `${reason}.${using} Pick another model with /model.`
}

/** Announces a background router catalog refresh, e.g. `RedRouter catalog updated: +2/−1 models, 3 renamed`. */
export function catalogUpdateMessage(update: { name: string; added: number; removed: number; renamed: number }) {
  // Limits or modes alone changed: the pickers already show them, nothing to announce.
  if (!update.added && !update.removed && !update.renamed) return undefined
  const renamed = update.renamed > 0 ? `, ${update.renamed} renamed` : ""
  return `${update.name} catalog updated: +${update.added}/−${update.removed} models${renamed}`
}

/**
 * The model a router reported serving the message, when it differs from the requested one. A flat
 * model id names no provider, so for one (`flat`) whichever offer served is reported, even the
 * vendor's own offer listed under the same id.
 */
export function servedModel(message: ModelRef, parts: Part[], flat = false) {
  const served = parts
    .flatMap((part) => (part.type === "step-finish" && part.servedModel ? [part.servedModel] : []))
    .at(-1)
  if (!served) return undefined
  if (flat) return served
  // Routers may report the requested model with or without its provider or upstream prefix.
  if ([message.modelID, `${message.providerID}/${message.modelID}`].includes(served)) return undefined
  if (message.modelID.endsWith(`/${served}`)) return undefined
  return served
}

/**
 * The model a router last reported serving a session's requests for a model, from the newest
 * response that says. Undefined when none did.
 */
export function latestServed(messages: Message[], parts: (messageID: string) => Part[], model: ModelRef) {
  return messages
    .filter(
      (message) =>
        message.role === "assistant" && message.providerID === model.providerID && message.modelID === model.modelID,
    )
    .flatMap((message) =>
      parts(message.id).flatMap((part) => (part.type === "step-finish" && part.servedModel ? [part.servedModel] : [])),
    )
    .at(-1)
}

/**
 * The variants of a fallback combo while a member other than its lead serves (`served`): that
 * member's. Undefined while the lead serves, for a model that is no such combo, and for a member
 * the model does not list. A flat model's members are matched exactly: the router reports the full
 * chained id, and several offers end in the same model id.
 */
export function servingVariants(model: Pick<Model, "comboMembers" | "flat">, served: string | undefined) {
  const members = model.comboMembers
  if (!served || !members?.length) return undefined
  const reported = model.flat ? served.replace(/\([^()]+\)\s*$/, "") : served
  const same = (id: string) =>
    id === reported || (!model.flat && (id.endsWith(`/${reported}`) || reported.endsWith(`/${id}`)))
  if (same(members[0].id)) return undefined
  return members.find((member) => same(member.id))?.variants
}

/**
 * Resolves a model id at a provider, following the earlier ids a router renamed and the reasoning
 * levels and modes it collapsed into a base model. A collapsed level or mode carries along as the
 * variant when the base model offers it.
 */
export function resolveModel(provider: Provider | undefined, modelID: string) {
  if (!provider) return undefined
  if (provider.models[modelID]) return { modelID, level: undefined }
  const earlier = (item: { id: string; aliases?: string[] }) => item.id === modelID || !!item.aliases?.includes(modelID)
  const match = Object.entries(provider.models).find(
    ([, model]) => !!model.aliases?.includes(modelID) || !!model.routerVariants?.some(earlier),
  )
  if (!match) return undefined
  const variant = match[1].routerVariants?.find(earlier)
  // A collapsed mode (review) is kept the same way: it is offered as a variant too.
  const choice = variant?.level ?? variant?.mode
  return { modelID: match[0], level: choice && match[1].variants?.[choice] ? choice : undefined }
}

/**
 * Rewrites saved model choices whose id a router renamed to the model's current id. Returns
 * undefined when nothing needs rewriting. Choices of providers that are not loaded stay as they are.
 */
export function migrateModelState(
  providers: Provider[],
  state: {
    model: Record<string, ModelRef>
    recent: ModelRef[]
    favorite: ModelRef[]
    variant: Record<string, string | undefined>
  },
) {
  const byID = new Map(providers.map((provider) => [provider.id, provider] as const))
  const moved = (ref: ModelRef) => {
    const found = resolveModel(byID.get(ref.providerID), ref.modelID)
    if (!found || found.modelID === ref.modelID) return undefined
    return { providerID: ref.providerID, modelID: found.modelID, level: found.level }
  }
  const refs = [...Object.values(state.model), ...state.recent, ...state.favorite]
  const keys = Object.keys(state.variant).filter((key) => key.includes("/"))
  if (!refs.some((ref) => moved(ref)) && !keys.some((key) => moved(parse(key)))) return undefined

  const current = (ref: ModelRef) => {
    const next = moved(ref)
    return { providerID: ref.providerID, modelID: next?.modelID ?? ref.modelID }
  }
  const variant = Object.fromEntries(
    Object.entries(state.variant)
      .map(([key, value]) => {
        const next = key.includes("/") ? moved(parse(key)) : undefined
        return { key: next ? `${next.providerID}/${next.modelID}` : key, value, renamed: !!next }
      })
      // A choice already saved under the current id wins over one saved under an earlier id.
      .toSorted((a, b) => Number(b.renamed) - Number(a.renamed))
      .map((item) => [item.key, item.value] as const),
  )
  const levels = Object.fromEntries(
    refs.flatMap((ref) => {
      const next = moved(ref)
      if (!next?.level || variant[`${next.providerID}/${next.modelID}`]) return []
      return [[`${next.providerID}/${next.modelID}`, next.level] as const]
    }),
  )
  return {
    model: Object.fromEntries(Object.entries(state.model).map(([agent, ref]) => [agent, current(ref)] as const)),
    recent: unique(state.recent.map(current)),
    favorite: unique(state.favorite.map(current)),
    variant: { ...variant, ...levels },
  }
}

function upstreamKeys(model: Model): string[] {
  // A flat id names no provider: each offer is a route of its own, and an offer id is always chained.
  if (model.flat) return (model.offers ?? []).flatMap((offer) => providerKeys(offer.provider, offer.id))
  if (!model.upstream) return []
  return providerKeys(model.upstream, model.id)
}

function providerKeys(upstream: { id: string; slug?: string }, id: string) {
  // A routed id is `[<router>/…]<upstream>/<model>`; the model part is what the upstream provider calls it.
  const part = Router.route(id).model
  return [upstream.id, upstream.slug]
    .filter((item, index, list): item is string => !!item && list.indexOf(item) === index)
    .map((item) => `${item}/${part}`)
}

function unique(refs: ModelRef[]) {
  return refs.filter(
    (ref, index) =>
      refs.findIndex((item) => item.providerID === ref.providerID && item.modelID === ref.modelID) === index,
  )
}
