import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import {
  flatOffers,
  modeBadge,
  originCategory,
  originDescription,
  originDescriptionDetail,
  originIndex,
  routeLabel,
  routerLabel,
} from "../util/model-origin"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  // Model names plus their route suffix (e.g. "via RedRouter » RedRouter") need more room than the
  // default dialog width gives before being cut off.
  dialog.setSize("large")
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)
  const origins = createMemo(() => originIndex(sync.data.provider))
  // Flat models whose offers are listed under them, keyed `provider/model`. A pinned offer opens its
  // flat model, so the current choice stays visible.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(
    new Set(
      [local.model.current()].flatMap((current) => {
        const pinned = current && flatKey(current)
        return pinned ? [pinned] : []
      }),
    ),
  )
  // The flat model a row belongs to: the flat model itself, or the one an offer row pins.
  function flatKey(value: { providerID: string; modelID: string } | string | undefined) {
    // Rows that are no model (a provider to connect) carry a string.
    if (!value || typeof value === "string") return undefined
    const model = sync.data.provider.find((item) => item.id === value.providerID)?.models[value.modelID]
    if (model?.flat) return `${value.providerID}/${model.id}`
    if (model?.pinOf) return `${value.providerID}/${model.pinOf}`
    return undefined
  }
  // Counts every active model by name, so entries that render with the same title (e.g. the same
  // upstream model served both directly via RedRouter and via a remote RedRouter it forwards to) can
  // get a distinguishing route suffix. `originIndex.also` cannot catch this by itself: it tracks
  // distinct router labels, and both entries here share the "RedRouter" label.
  const duplicateNames = createMemo(() => {
    const counts = new Map<string, number>()
    sync.data.provider.forEach((provider) =>
      Object.values(provider.models).forEach((model) => {
        // A pinned offer is listed under its flat model, not as a model of its own.
        if (model.status === "deprecated" || model.pinOf) return
        const name = model.name ?? model.id
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }),
    )
    return counts
  })

  function routeSuffix(provider: (typeof sync.data.provider)[number], model: (typeof provider.models)[string]) {
    const name = model.name ?? model.id
    if ((duplicateNames().get(name) ?? 0) <= 1) return undefined
    return routeLabel(provider, model)
  }

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const index = origins()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        const route = routeSuffix(provider, model)
        // The route already shows in the title suffix below; the description drops it to avoid repeating it.
        const origin = route
          ? originDescriptionDetail(index, provider, model)
          : originDescription(index, provider, model)
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            // The route suffix keeps duplicates (same model via different connections) distinguishable
            // even when the description gets cut off by a narrow row.
            title: route ? `${model.name ?? item.modelID} · ${route}` : (model.name ?? item.modelID),
            // Outside its provider's section the row names the provider unless the router label already does.
            description: routerLabel(provider) === provider.name ? origin : `${provider.name} · ${origin}`,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : modeBadge(model),
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          // A pinned offer is listed under its flat model (see `offers` below), not as a model of its own.
          filter(([_, info]) => !info.pinOf),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const route = routeSuffix(provider, info)
            // The route already shows in the title suffix below; the description drops it to avoid repeating it.
            const origin = route
              ? originDescriptionDetail(index, provider, info)
              : originDescription(index, provider, info)
            return {
              value: { providerID: provider.id, modelID: model },
              // The route suffix keeps duplicates (same model via different connections)
              // distinguishable even when the description gets cut off by a narrow row.
              title: route ? `${info.name ?? model} · ${route}` : (info.name ?? model),
              releaseDate: info.release_date,
              description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                ? `${origin} (Favorite)`
                : origin,
              category: connected() ? originCategory(provider, info) : undefined,
              disabled: provider.id === "opencode" && model.includes("-nano"),
              footer:
                (info.cost?.input === 0 && provider.id === "opencode") ||
                (info.flat && info.offers?.length && info.offers.every((offer) => offer.free))
                  ? "Free"
                  : modeBadge(info),
              onSelect() {
                onSelect(provider.id, model)
              },
            }
          }),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
          // Keeps each upstream group of a router together (the sort is stable).
          (options) => sortBy(options, (option) => option.category ?? ""),
          // An expanded flat model lists its offers right under it. Picking one pins it: its pin id is
          // saved, never the offer id, which can be the flat id itself.
          flatMap((option) => {
            const info = provider.models[option.value.modelID]
            if (!info?.flat || !expanded().has(`${provider.id}/${info.id}`)) return [option]
            return [
              option,
              ...flatOffers(provider, info).map((row) => ({
                value: row.pin
                  ? { providerID: provider.id, modelID: row.pin }
                  : { providerID: provider.id, modelID: info.id, offer: row.offer.id },
                title: `  ↳ ${row.route}`,
                releaseDate: option.releaseDate,
                description: row.detail || (row.pin ? "Pin this offer" : ""),
                category: option.category,
                disabled: !row.pin,
                footer: row.offer.free ? "Free" : undefined,
                onSelect() {
                  if (row.pin) onSelect(provider.id, row.pin)
                },
              })),
            ]
          }),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
        {
          command: "model.dialog.offers",
          title: "Offers",
          hidden:
            !connected() || !sync.data.provider.some((item) => Object.values(item.models).some((model) => model.flat)),
          disabled: (option) => !flatKey(option?.value),
          onTrigger: (option) => {
            const key = flatKey(option.value)
            if (!key) return
            setExpanded((current) => {
              const next = new Set(current)
              if (!next.delete(key)) next.add(key)
              return next
            })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
