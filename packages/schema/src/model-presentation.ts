export * as ModelPresentation from "./model-presentation.js"

import { Router } from "./router.js"

/**
 * How clients put models into words and order them in pickers. Shared by the TUI and the desktop app
 * so both read and sort a catalog the same way; the app passes translated `Text`, the TUI the English
 * defaults.
 */

type Model = {
  id: string
  providerID: string
  name: string
  via?: string
  flat?: boolean
  aliases?: ReadonlyArray<string>
  upstream?: { name: string; subscription?: boolean }
  offers?: ReadonlyArray<{ id: string; available?: boolean }>
}

type Provider = { id: string; name: string; integrationID?: string; router?: { role?: string } }

export type ModelRef = { providerID: string; modelID: string }

export const text = {
  aliases: (aliases: string) => `aliases: ${aliases}`,
  automaticRoute: "automatic route",
  subscription: "subscription",
  free: "free",
  price: (input: string, output: string) => `${input}/${output} per 1M`,
  available: "available",
  unavailable: "unavailable",
  servingNow: "serving now",
  cannotBePinned: "cannot be pinned",
}

export type Text = typeof text

/**
 * The connection and any reported hops, without changing the model ID sent to the provider. Cramped
 * spots such as the prompt footer pass `Router.HOP_SEPARATOR_COMPACT` for `RedRouter»Antigravity`.
 */
export function modelRoute(model: Model, provider: Provider | undefined, separator = Router.HOP_SEPARATOR) {
  const connection = provider?.name ?? model.providerID
  if (model.providerID !== "red-router" && model.providerID !== "9router") return connection
  const routed = Router.routeOf(model)
  const hops = model.via ? [model.via] : routed.hops.map(Router.hopName)
  const upstream = model.upstream?.name ?? (!model.flat ? routed.provider : undefined)
  return [connection, ...hops, upstream].filter((part): part is string => !!part).join(separator)
}

/** What a RedRouter connection's key may do, in words (`admin key`), from the provider's saved router connection. */
export function keyRoleLabel(provider: Provider | undefined) {
  return provider?.router?.role ? `${provider.router.role} key` : undefined
}

/** The provider an integration connected that carries a RedRouter key role, if any. */
export function integrationRouterProvider<T extends Provider>(providers: ReadonlyArray<T>, integrationID: string) {
  return providers.find(
    (provider) => (provider.integrationID === integrationID || provider.id === integrationID) && provider.router?.role,
  )
}

/** The key role of the provider an integration connected, for the integration's own rows. */
export function integrationKeyRole(providers: ReadonlyArray<Provider>, integrationID: string) {
  return keyRoleLabel(integrationRouterProvider(providers, integrationID))
}

/** The details a picker row shows under a model: route, id, aliases, and whether it routes itself or bills a subscription. */
export function modelDetails(model: Model, provider: Provider | undefined, words: Text = text) {
  return [
    modelRoute(model, provider),
    model.id,
    ...(model.aliases?.length ? [words.aliases(model.aliases.join(", "))] : []),
    ...(model.flat ? [words.automaticRoute] : []),
    ...(model.upstream?.subscription ? [words.subscription] : []),
  ]
}

export function modelDescription(model: Model, provider: Provider | undefined, words: Text = text) {
  return modelDetails(model, provider, words).join(" · ")
}

/** How an offer of a flat model reads in a picker: price, availability, and whether it serves now or can be pinned. */
export function offerDetails(
  entry: { offer: Pick<Router.Offer, "price" | "free" | "available">; lead: boolean; model?: unknown },
  words: Text = text,
) {
  return [
    offerPrice(entry.offer, words),
    entry.offer.available ? words.available : words.unavailable,
    ...(entry.lead ? [words.servingNow] : []),
    ...(entry.model ? [] : [words.cannotBePinned]),
  ]
    .filter((part): part is string => !!part)
    .join(" · ")
}

/** An offer's price in dollars per million tokens (`$3/$15 per 1M`), `free`, or undefined when unknown. */
export function offerPrice(offer: Pick<Router.Offer, "price" | "free">, words: Text = text) {
  if (offer.free) return words.free
  if (!offer.price) return undefined
  const dollars = (value: number | undefined) => (value === undefined ? "?" : `$${Number(value.toFixed(4))}`)
  return words.price(dollars(offer.price.input), dollars(offer.price.output))
}

export function modelLabel(model: Model, providers: ReadonlyArray<Provider>) {
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

/** True when every price tier of a model costs nothing for input. */
export function free(model: { cost: ReadonlyArray<{ input: number }> }) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}

export function preferenceKey(model: ModelRef) {
  return `${model.providerID}/${model.modelID}`
}

/** The recent list after choosing `model`: newest first, unique, at most ten. */
export function recentModels(model: ModelRef, recent: ReadonlyArray<ModelRef>) {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = preferenceKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

/** The favorites after (un)marking `model`: a new favorite goes first, the others keep their order. */
export function favoriteModels<T extends ModelRef>(model: T, favorite: ReadonlyArray<T>, enabled: boolean) {
  const current = favorite.filter((item) => preferenceKey(item) !== preferenceKey(model))
  return enabled ? [model, ...current] : current
}

/** The next entry of `list` from `current` in `direction`, wrapping around; the first (or last) when current is not listed. */
export function cycleModel<T extends ModelRef>(
  list: ReadonlyArray<T>,
  current: ModelRef | undefined,
  direction: 1 | -1,
) {
  if (list.length === 0) return undefined
  const index = current ? list.findIndex((item) => preferenceKey(item) === preferenceKey(current)) : -1
  if (index === -1) return list[direction === 1 ? 0 : list.length - 1]
  return list[(index + direction + list.length) % list.length]
}

/** Search results with favorites first, keeping the match order within each half. */
export function prioritizeFavorites<T extends { value: ModelRef }>(options: T[], favorites: ReadonlySet<string>) {
  return options.toSorted(
    (a, b) => Number(favorites.has(preferenceKey(b.value))) - Number(favorites.has(preferenceKey(a.value))),
  )
}

/**
 * Picker order: grouped lists put OpenCode Go, then OpenCode Zen, then providers by name; within a
 * group (and in ungrouped search results) free models first, then newest first, then by title.
 */
export function sortModelOptions<
  T extends {
    providerID?: string
    providerName?: string
    releaseDate: string | number
    title: string
    footer?: string
  },
>(options: T[], grouped = true) {
  return options.toSorted((a, b) => {
    const provider = grouped
      ? Number(b.providerID === "opencode-go") - Number(a.providerID === "opencode-go") ||
        Number(b.providerID === "opencode") - Number(a.providerID === "opencode")
      : 0
    if (provider !== 0) return provider

    const name = grouped ? (a.providerName ?? "").localeCompare(b.providerName ?? "") : 0
    if (name !== 0) return name

    const free = Number(b.footer === "Free") - Number(a.footer === "Free")
    if (free !== 0) return free

    const release = Number(b.releaseDate) - Number(a.releaseDate)
    if (release !== 0) return release

    return a.title.localeCompare(b.title)
  })
}
