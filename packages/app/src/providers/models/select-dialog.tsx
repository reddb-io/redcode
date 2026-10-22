import { ModelPopoverView, ModelTriggerButton } from "./popover.react"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ModelDrawerBody } from "./drawer.react"
import { ModelSelectionDialog } from "./select-dialog.react"
import { useNativeDialog } from "@/runtime/react/dialog"
import { Component, createMemo, JSX, Show, Suspense, lazy } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"

import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useModels } from "@/providers/models/models"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ModelOptionBase } from "./sections"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { Router } from "@opencode/schema/router"
import "@/settings/settings.css"
import "./select-dialog.css"

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

type ModelState = ModelSelection

type ModelItem = ReturnType<ModelState["list"]>[number]
type OfferEntry = ReturnType<typeof Router.offerGroups<ModelItem>>[number]["offers"][number]

type ModelOption = ModelOptionBase & { item: ModelItem }

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`

/** The shared model wording (route details, offer prices) in the current language. */
function useModelWords() {
  const language = useLanguage()
  const amount = (value: number | undefined) => (value === undefined ? "?" : String(Number(value.toFixed(4))))

  return createMemo(
    (): ModelPresentation.Text => ({
      aliases: (aliases) => language.t("model.details.aliases", { aliases }),
      automaticRoute: language.t("model.details.automaticRoute"),
      subscription: language.t("model.details.subscription"),
      free: language.t("model.tag.free"),
      price: (price) => language.t("model.offers.price", { input: amount(price.input), output: amount(price.output) }),
      available: language.t("model.offers.available"),
      unavailable: language.t("model.offers.unavailable"),
      servingNow: language.t("model.offers.lead"),
      cannotBePinned: language.t("model.offers.unpinnable"),
    }),
  )
}

export function createModelListServices(props: {
  mobile?: boolean
  open?: boolean
  controller: ModelSelectorController
}) {
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      mobile: props.mobile ?? false,
      open: props.open ?? true,
      current: props.controller.current(),
      provider: props.controller.provider(),
      favorites: props.controller.favorites().map((item) => ({ ...item })),
      recent: props.controller.recent().map((item) => ({ ...item })),
      options: (props.open === false ? [] : props.controller.options()).map((option) => ({
        ...option,
        item: {
          ...option.item,
          provider: { ...option.item.provider },
          limit: { ...option.item.limit },
          capabilities: { ...option.item.capabilities, input: { ...option.item.capabilities.input } },
        },
        favorite: props.controller.favorite(option),
        offers: props.controller.offers(option.item).map((entry) => ({
          ...entry,
          route: Router.offerRoute(entry.offer),
          details: props.controller.offerDetails(entry),
        })),
      })),
    })),
    select: props.controller.select,
    toggleFavorite: props.controller.toggleFavorite,
  }
}

type ModelSelectorTriggerProps = { "aria-haspopup": "dialog"; "aria-expanded": boolean; onClick: () => void }

type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  unpaid?: boolean
  triggerProvider?: { id: string; canonical?: string }
  triggerLabel: string
  triggerClass?: string
  onClose?: () => void
}) {
  const dialog = useDialog()
  const mobile = createMediaQuery("(max-width: 767px)")
  const data = useData()
  const location = useWorkspaceLocation()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => props.onClose?.(),
  })
  const trigger: ModelSelectorTrigger = (triggerProps) => (
    <ReactView
      component={ModelTriggerButton}
      props={{
        provider: props.triggerProvider,
        label: props.triggerLabel,
        className: props.triggerClass,
        open: triggerProps["aria-expanded"],
        onClick: triggerProps.onClick,
      }}
    />
  )

  const chatgptPlan = () => {
    if (!controller.current()?.startsWith("openai:")) return false

    const connection = data.location.integration
      .list(location().ref)
      ?.find((integration) => integration.id === "openai")?.connections[0]

    return connection?.type === "credential" && connection.method === "oauth"
  }

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const connect = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => (
      <DialogConnectProvider
        directory={location().directory}
        onPickModel={(provider) => dialog.show(() => <DialogSelectModel provider={provider} model={props.model} />)}
      />
    ))
  }

  return (
    <Show
      when={mobile()}
      fallback={
        <ModelSelectorPopoverView
          provider={props.triggerProvider}
          label={props.triggerLabel}
          triggerClass={props.triggerClass}
          controller={controller}
          chatgptPlan={chatgptPlan()}
          onManage={manage}
          onConnect={connect}
          onClose={() => props.onClose?.()}
        />
      }
    >
      <ModelSelectorDrawer
        trigger={trigger}
        model={props.model}
        provider={props.provider}
        onConnect={props.unpaid ? connect : undefined}
        chatgptPlan={chatgptPlan()}
        onClose={() => props.onClose?.()}
        onManage={manage}
      />
    </Show>
  )
}

function ModelSelectorDrawer(props: {
  trigger: ModelSelectorTrigger
  model?: ModelState
  provider?: string
  chatgptPlan?: boolean
  onClose: () => void
  onManage: () => void
  onConnect?: () => void
}) {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    loaded: boolean
    restoreTrigger: boolean
    action?: "select" | "manage" | "connect"
  }>({
    open: false,
    loaded: false,
    restoreTrigger: true,
  })

  let trigger: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => setStore({ open: false, action: "select", restoreTrigger: false }),
  })

  const list = createModelListServices({
    mobile: true,
    get open() {
      return store.open
    },
    controller,
  })
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    canConnect: !!props.onConnect,
    chatgptPlan: props.chatgptPlan ?? false,
  }))
  return (
    <>
      <div ref={trigger} class="min-w-0">
        {props.trigger({
          "aria-haspopup": "dialog",
          get "aria-expanded"() {
            return store.open
          },
          onClick: () => setStore({ open: true, loaded: true, restoreTrigger: true }),
        })}
      </div>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            hideHeader
            title={language.t("dialog.model.select.title")}
            open={store.open}
            onOpenChange={(open) => setStore("open", open)}
            initialFocus={() => content}
            returnFocus={() => trigger?.querySelector("button") ?? undefined}
            onFinalFocus={(event) => {
              if (!store.restoreTrigger) event.preventDefault()
            }}
            onContentPresentChange={(present) => {
              if (present) return
              const action = store.action
              setStore("action", undefined)

              if (action === "manage") {
                props.onManage()

                return
              }

              if (action === "connect") {
                props.onConnect?.()

                return
              }

              if (action === "select") queueMicrotask(props.onClose)
            }}
          >
            <div
              ref={content}
              tabIndex={-1}
              data-slot="model-selector-drawer"
              class="flex min-h-0 flex-col gap-2 outline-none"
            >
              <ReactView
                component={ModelDrawerBody}
                props={{
                  source,
                  list,
                  manage: () => setStore({ open: false, action: "manage", restoreTrigger: false }),
                  connect: () => setStore({ open: false, action: "connect", restoreTrigger: false }),
                }}
              />
            </div>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </>
  )
}

type ModelSelectorController = ReturnType<typeof createModelSelectorController>

/**
 * The picker the TUI's model dialog defines: every connected model (minus the ones hidden in
 * Settings › Models), Favorites then Recent then the rest by connection and route when not searching,
 * and favorites first among search results.
 */
function createModelSelectorController(input: {
  provider: () => string | undefined
  model?: ModelState
  onSelect: (item: ModelItem) => void
}) {
  const model = input.model ?? useLocal().model
  const models = useModels()
  const data = useData()
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const words = useModelWords()
  const [state, setState] = createStore({ refreshing: false })

  const all = () => model.list().filter((item) => (input.provider() ? item.provider.id === input.provider() : true))
  const infos = createMemo(
    () =>
      new Map((data.location.model.list(location().ref) ?? []).map((info) => [`${info.providerID}:${info.id}`, info])),
  )
  const providers = createMemo(
    () => new Map((data.location.provider.list(location().ref) ?? []).map((provider) => [provider.id, provider])),
  )
  // Models pinning one offer of a flat router model are listed among that model's offers instead.
  const offers = createMemo(
    () => new Map(Router.offerGroups(all()).map((group) => [modelKey(group.model), group.offers] as const)),
  )

  const options = createMemo(() =>
    Router.offerGroups(all().filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))).map(
      (group): ModelOption => {
        const item = group.model
        const info = infos().get(modelKey(item))
        const provider = providers().get(item.provider.id)
        const free = info ? ModelPresentation.free(info) : item.provider.id === "opencode" && !item.cost?.input

        return {
          key: modelKey(item),
          item,
          value: { providerID: item.provider.id, modelID: item.id },
          title: item.name,
          providerID: item.provider.id,
          providerName: item.provider.name,
          category: info ? ModelPresentation.modelRoute(info, provider) : item.provider.name,
          description: info ? ModelPresentation.modelDescription(info, provider, words()) : item.id,
          releaseDate: info?.time.released ?? (Date.parse(item.release_date) || 0),
          footer: free ? "Free" : undefined,
        }
      },
    ),
  )

  const favorite = (option: ModelOption) => models.favorite.has(option.value)

  // Rebuilds the location's services, which asks every provider for its models again, then reads the lists back.
  const refresh = async () => {
    if (state.refreshing) return
    setState("refreshing", true)
    const ref = location().ref
    await sdk.api.location
      .reload()
      .then(() => {
        data.location.integration.invalidate(ref)
        data.location.provider.invalidate(ref)
        data.location.model.invalidate(ref)

        return Promise.all([
          data.location.integration.sync(ref),
          data.location.provider.sync(ref),
          data.location.model.sync(ref),
        ])
      })
      .then(() => showToast({ variant: "success", title: language.t("dialog.model.refresh.done") }))
      .catch((error: unknown) =>
        showToast({ title: language.t("common.requestFailed"), description: formatServerError(error, language.t) }),
      )
      .finally(() => setState("refreshing", false))
  }

  return {
    options,
    favorites: models.favorite.list,
    recent: models.recent.list,
    provider: input.provider,
    offers: (item: ModelItem): OfferEntry[] => offers().get(modelKey(item)) ?? [],
    offerDetails: (entry: OfferEntry) => ModelPresentation.offerDetails(entry, words()),
    favorite,
    toggleFavorite: (option: ModelOption) => models.favorite.toggle(option.value),
    refreshing: () => state.refreshing,
    refresh,
    current: () => {
      const value = model.current()

      return value ? modelKey(value) : undefined
    },
    select: (item: ModelItem) => {
      model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
      input.onSelect(item)
    },
  }
}

export function ModelSelectorPopoverView(props: {
  provider?: { id: string; canonical?: string }
  label: string
  triggerClass?: string
  controller: ModelSelectorController
  chatgptPlan?: boolean
  onManage: () => void
  onConnect: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ open: false })
  const services = createModelListServices({
    controller: props.controller,
    get open() {
      return state.open
    },
  })
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    label: props.label,
    provider: props.provider ? { ...props.provider } : undefined,
    triggerClass: props.triggerClass,
    chatgptPlan: props.chatgptPlan ?? false,
    refreshing: props.controller.refreshing(),
  }))
  return (
    <ReactView
      component={ModelPopoverView}
      props={{
        source,
        services,
        refresh: () => void props.controller.refresh(),
        connect: props.onConnect,
        manage: props.onManage,
        close: props.onClose,
        onOpenChange: (open) => setState("open", open),
      }}
    />
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const modal = useNativeDialog()
  const language = useLanguage()
  const location = useWorkspaceLocation()
  const model = props.model ?? useLocal().model
  const models = useModels()
  const [store, setStore] = createStore({ variants: false })

  const connect = () => {
    void import("@/providers/connect/dialog").then((x) => {
      void dialog.show(() => (
        <x.DialogConnectProvider
          directory={location().directory}
          onPickModel={(provider) => dialog.show(() => <DialogSelectModel provider={provider} model={props.model} />)}
        />
      ))
    })
  }

  const manage = () => {
    void import("./manage").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  // Like the TUI, a model with variants asks for one right away, unless one is already chosen for it.
  const chosen = (item: ModelItem) => {
    const variants = model.variant.list()
    const preference = models.variant.get({ providerID: item.provider.id, modelID: item.id })

    if (variants.length === 0 || preference !== undefined || model.variant.current() !== undefined) {
      dialog.close()

      return
    }

    setStore("variants", true)
  }

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: chosen,
  })
  const services = createModelListServices({ controller })
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    variants: store.variants,
    title: language.t(store.variants ? "dialog.model.variant.title" : "dialog.model.select.title"),
    modelName: model.current()?.name,
    choices: ["default", ...model.variant.list()],
    current: model.variant.current() ?? "default",
    refreshing: controller.refreshing(),
  }))
  return (
    <ReactView
      component={ModelSelectionDialog}
      props={{
        source,
        services,
        close: modal.close,
        refresh: () => void controller.refresh(),
        connect,
        manage,
        selectVariant: (value) => {
          model.variant.set(value === "default" ? undefined : value)
          modal.close()
        },
      }}
    />
  )
}
