import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { modelPreferenceKey } from "../model-preference"
import { useLocation } from "../context/location"
import { modelDescription, modelRoute, offerDetails } from "../util/model-presentation"
import { Router } from "@opencode/schema/router"

// Offer rows carry the flat model they belong to, so a pinned model listed elsewhere (favorites,
// recents) never shares a row value with its offer row.
type Value = { providerID: string; modelID: string; offerOf?: string; pinned?: boolean }

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()
  const location = useLocation()
  const [query, setQuery] = createSignal("")
  const favoritePriority = new Set(local.model.favorite().map(modelPreferenceKey))

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])
  // Models pinning one offer of a flat model are listed under that model's offers instead.
  const groups = createMemo(() => Router.offerGroups(models()))
  const offerKey = (providerID: string, modelID: string) => `${providerID}/${modelID}`
  // A pinned current model opens with its flat model's offers expanded, so the choice stays visible.
  const initial = local.model.current()
  const pinnedCurrent = initial
    ? models().find((model) => model.providerID === initial.providerID && model.id === initial.modelID)?.pinOf
    : undefined
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(
    new Set(initial && pinnedCurrent ? [offerKey(initial.providerID, pinnedCurrent)] : []),
  )
  const toggleOffers = (value: Value) => {
    const key = offerKey(value.providerID, value.offerOf ?? value.modelID)
    const next = new Set(expanded())
    if (!next.delete(key)) next.add(key)
    setExpanded(next)
  }

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            // Names differ between routed providers, so the id is searchable too.
            searchText: model.id,
            releaseDate: model.time.released,
            description: modelDescription(model, provider),
            category,
            footer: free(model) ? "Free" : undefined,
            onSelect: () => {
              onSelect(model.providerID, model.id)
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

    const modelOptions = sortModelOptions(
      groups()
        .filter((group) => group.model.status !== "deprecated")
        .filter((group) => (props.providerID ? group.model.providerID === props.providerID : true))
        .map((group) => {
          const model = group.model
          const provider = providers().get(model.providerID)
          const key = modelPreferenceKey({ providerID: model.providerID, modelID: model.id })
          const favorite = favorites.some((item) => modelPreferenceKey(item) === key)
          const value: Value = { providerID: model.providerID, modelID: model.id }
          return {
            value,
            providerID: model.providerID,
            providerName: provider?.name ?? model.providerID,
            title: model.name,
            releaseDate: model.time.released,
            description: [
              modelDescription(model, provider),
              ...(favorite ? ["Favorite"] : []),
              ...(group.offers.length ? [`${group.offers.length} offers`] : []),
            ].join(" · "),
            category: connected() ? modelRoute(model, provider) : undefined,
            footer: free(model) ? "Free" : undefined,
            offers: group.offers,
            onSelect() {
              onSelect(model.providerID, model.id)
            },
          }
        })
        .filter((option) => {
          if (!showSections) return true
          if (
            favorites.some(
              (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
            )
          )
            return false
          if (
            recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
          )
            return false
          return true
        }),
      connected(),
    )

    // An expanded flat model is followed by its offers; selecting a pinnable one selects its pinned model.
    const withOffers = (items: typeof modelOptions) =>
      items.flatMap((option) => {
        if (!option.offers.length || !expanded().has(offerKey(option.value.providerID, option.value.modelID)))
          return [option]
        return [
          option,
          ...option.offers.map((entry) => {
            const pinned = entry.model
            const value: Value = {
              providerID: option.value.providerID,
              modelID: pinned?.id ?? entry.offer.id,
              offerOf: option.value.modelID,
              pinned: Boolean(pinned),
            }
            return {
              ...option,
              value,
              title: `  ↳ ${Router.offerRoute(entry.offer)}`,
              description: offerDetails(entry),
              footer: undefined,
              offers: [],
              onSelect() {
                if (pinned) onSelect(pinned.providerID, pinned.id)
              },
            }
          }),
        ]
      })

    if (needle) {
      return withOffers(
        prioritizeFavorites(
          sortModelOptions(
            fuzzysort.go(needle, modelOptions, { keys: ["title", "category", "description"] }).map((item) => item.obj),
            false,
          ),
          favoritePriority,
        ),
      )
    }

    return [...favoriteOptions, ...recentOptions, ...withOffers(modelOptions)]
  })

  const provider = createMemo(() => (props.providerID ? providers().get(props.providerID) : undefined))

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (cur && list.includes(cur)) {
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
    <DialogSelect<Value>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect an integration" : "View all integrations",
          selection: "none",
          onTrigger() {
            dialog.replace(() => (
              <DialogIntegration
                onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)}
              />
            ))
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          disabled: (option) => option?.value.pinned === false,
          onTrigger: (option) => {
            local.model.toggleFavorite({ providerID: option.value.providerID, modelID: option.value.modelID })
          },
        },
        {
          command: "model.dialog.offers",
          title: "Offers",
          hidden: !groups().some((group) => group.offers.length > 0),
          disabled: (option) =>
            !option ||
            !groups().some(
              (group) =>
                group.offers.length > 0 &&
                group.model.providerID === option.value.providerID &&
                group.model.id === (option.value.offerOf ?? option.value.modelID),
            ),
          onTrigger: (option) => toggleOffers(option.value),
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      focusCurrent={false}
    />
  )
}

export function prioritizeFavorites<T extends { value: { providerID: string; modelID: string } }>(
  options: T[],
  favorites: Set<string>,
) {
  return options.toSorted(
    (a, b) => Number(favorites.has(modelPreferenceKey(b.value))) - Number(favorites.has(modelPreferenceKey(a.value))),
  )
}

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

function free(model: { cost: Array<{ input: number }> }) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}
