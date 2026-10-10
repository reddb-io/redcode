import { type Accessor, createMemo } from "solid-js"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { createSimpleContext } from "@opencode/ui/context"
import { useProviders } from "@/providers/catalog/providers"
import { useGlobal } from "@/runtime/server/runtime"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

const createModelsController = (directory: Accessor<string | undefined>) => {
  const providers = useProviders(() => directory())
  const models = useGlobal().models
  const store = models.store
  const setStore = models.set

  const available = createMemo(() =>
    providers.connected().flatMap((p) =>
      Object.values(p.models).map((m) => ({
        ...m,
        provider: p,
      })),
    ),
  )

  const visibility = createMemo(() => {
    const map = new Map<string, Visibility>()

    for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)

    return map
  })

  const list = createMemo(() =>
    available().map((m) => ({
      ...m,
      name: m.name.replace("(latest)", "").trim(),
      latest: m.name.includes("(latest)"),
    })),
  )

  const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

  function update(model: ModelKey, state: Visibility) {
    const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)

    if (index >= 0) {
      setStore("user", index, (current) => ({ ...current, visibility: state }))

      return
    }

    setStore("user", store.user.length, { ...model, visibility: state })
  }

  // Every connected model can be picked; the Models settings only hide the ones a person turned off.
  const visible = (model: ModelKey) => visibility().get(modelKey(model)) !== "hide"

  const favorites = createMemo(() => new Set(store.favorite.map(ModelPresentation.preferenceKey)))

  const setFavorite = (model: ModelKey, enabled: boolean) =>
    setStore("favorite", ModelPresentation.favoriteModels(model, store.favorite, enabled))

  const setVisibility = (model: ModelKey, state: boolean) => {
    update(model, state ? "show" : "hide")
  }

  const push = (model: ModelKey) => setStore("recent", ModelPresentation.recentModels(model, store.recent))

  const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
  const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

  const setVariant = (model: ModelKey, value: string | undefined) => {
    const key = variantKey(model)

    if (!store.variant) {
      setStore("variant", { [key]: value ?? "default" })

      return
    }

    setStore("variant", key, value ?? "default")
  }

  return {
    ready: models.ready,
    list,
    find,
    visible,
    setVisibility,
    recent: {
      list: models.recent,
      push,
    },
    favorite: {
      list: () => store.favorite,
      has: (model: ModelKey) => favorites().has(ModelPresentation.preferenceKey(model)),
      set: setFavorite,
      toggle: (model: ModelKey) => setFavorite(model, !favorites().has(ModelPresentation.preferenceKey(model))),
    },
    variant: {
      get: getVariant,
      set: setVariant,
    },
  }
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  gate: false,
  init: (props: { directory?: string | Accessor<string | undefined> } = {}) => {
    return createModelsController(() => (typeof props.directory === "function" ? props.directory() : props.directory))
  },
})
