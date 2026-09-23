import type { Message, Model, Part, Provider } from "@reddb-io/redcode-sdk/v2"
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

/** Where a model comes from: `direct`, or `via RedRouter · OpenAI Codex · subscription`, plus duplicates. */
export function originDescription(index: OriginIndex, provider: Provider, model: Model) {
  const router = routerLabel(provider)
  const also = index.also(provider, model)
  if (!router) return ["direct", ...(also.length ? [`also via ${also.join(", ")}`] : [])].join(" · ")
  return [
    // A router serving the model through another router (a remote RedRouter) names that one too.
    model.via ? `via ${router} → ${model.via}` : `via ${router}`,
    ...(model.upstream ? [model.upstream.name] : []),
    ...(model.upstream?.subscription ? ["subscription"] : []),
    ...(also.length ? [`also ${also.join(", ")}`] : []),
  ].join(" · ")
}

/** Routed models are grouped per upstream provider inside their router connection. */
export function originCategory(provider: Provider, model: Model) {
  if (!routerLabel(provider) || !model.upstream) return provider.name
  return `${provider.name} · ${model.upstream.name}`
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

/** Announces a background router catalog refresh, e.g. `RedRouter catalog updated: +2/−1 models, 3 renamed`. */
export function catalogUpdateMessage(update: { name: string; added: number; removed: number; renamed: number }) {
  // Limits or modes alone changed: the pickers already show them, nothing to announce.
  if (!update.added && !update.removed && !update.renamed) return undefined
  const renamed = update.renamed > 0 ? `, ${update.renamed} renamed` : ""
  return `${update.name} catalog updated: +${update.added}/−${update.removed} models${renamed}`
}

/** The model a router reported serving the message, when it differs from the requested one. */
export function servedModel(message: ModelRef, parts: Part[]) {
  const served = parts
    .flatMap((part) => (part.type === "step-finish" && part.servedModel ? [part.servedModel] : []))
    .at(-1)
  if (!served) return undefined
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
 * the model does not list.
 */
export function servingVariants(model: Pick<Model, "comboMembers">, served: string | undefined) {
  const members = model.comboMembers
  if (!served || !members?.length) return undefined
  const same = (id: string) => id === served || id.endsWith(`/${served}`) || served.endsWith(`/${id}`)
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

function upstreamKeys(model: Model) {
  if (!model.upstream) return []
  // A routed id is `<upstream>/<model>`; the model part is what the upstream provider calls it.
  const part = model.id.slice(model.id.indexOf("/") + 1)
  return [model.upstream.id, model.upstream.slug]
    .filter((id, index, list): id is string => !!id && list.indexOf(id) === index)
    .map((id) => `${id}/${part}`)
}

function unique(refs: ModelRef[]) {
  return refs.filter(
    (ref, index) =>
      refs.findIndex((item) => item.providerID === ref.providerID && item.modelID === ref.modelID) === index,
  )
}
