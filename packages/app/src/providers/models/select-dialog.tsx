import { Popover } from "@kobalte/core/popover"
import { Component, ComponentProps, createEffect, createMemo, For, JSX, Show, Suspense, lazy, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"

import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useModels } from "@/providers/models/models"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { ModelTooltip } from "./tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { handleDocumentSearchKeydown } from "@/shell/commands/search-keydown"
import { createMenuDismissController } from "@/shell/commands/menu-dismiss"
import { createEventListener } from "@solid-primitives/event-listener"
import { modelSections, type ModelOptionBase } from "./sections"
import { SettingsList } from "@/settings/list"
import { ProviderModelIcon } from "@/providers/models/provider-group"
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

type ModelSection = {
  key: string
  title?: string
  icon?: "star" | "reset"
  provider?: { id: string; name: string; canonical?: string }
  items: ModelOption[]
}

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`
const manageKey = "action:manage"
const refreshKey = "action:refresh"
const connectKey = "action:connect"
const isModKey = (event: KeyboardEvent) => event.metaKey || event.ctrlKey

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

function FavoriteButton(props: { favorite: boolean; mobile?: boolean; onToggle: () => void; class?: string }) {
  const language = useLanguage()

  return (
    <button
      type="button"
      tabIndex={-1}
      data-action="model-favorite"
      aria-pressed={props.favorite}
      aria-label={language.t(props.favorite ? "dialog.model.favorite.remove" : "dialog.model.favorite.add")}
      title={language.t(props.favorite ? "dialog.model.favorite.remove" : "dialog.model.favorite.add")}
      class={`flex size-7 items-center justify-center rounded-sm text-ink-muted hover:bg-foreground/8 hover:text-foreground ${props.class ?? ""}`}
      classList={{
        "text-foreground": props.favorite,
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100": !props.favorite && !props.mobile,
      }}
      onPointerDown={(event) => {
        // Keeps focus (and the active row) on the search field and stops the row behind from selecting.
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onToggle()
      }}
    >
      <Icon name={props.favorite ? "star-filled" : "star"} size="small" />
    </button>
  )
}

const ModelList: Component<{
  mobile?: boolean
  open?: boolean
  controller: ModelSelectorController
}> = (props) => {
  const language = useLanguage()
  const controller = props.controller

  const [store, setStore] = createStore<{
    search: string
    active: string
    offers: Record<string, boolean>
  }>({
    search: "",
    active: props.mobile ? (controller.current() ?? "") : "",
    offers: {},
  })

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!props.mobile || !open) return
        setStore({ search: "", active: controller.current() ?? "" })
      },
    ),
  )
  const sections = createMemo(() => controller.sections(store.search))
  const options = createMemo(() => sections().flatMap((section) => section.items))

  let scrollRef: HTMLDivElement | undefined

  const setSearch = (value: string) => {
    const first = controller
      .sections(value)
      .flatMap((section) => section.items)
      .at(0)
    setStore({ search: value, active: first?.key ?? "" })
  }

  const moveActive = (delta: number) => {
    const keys = options().map((option) => option.key)

    if (keys.length === 0) return
    const index = keys.indexOf(store.active)
    const start = index === -1 ? (delta > 0 ? -1 : 0) : index
    setStore("active", keys[(start + delta + keys.length) % keys.length])
    queueMicrotask(() => {
      scrollRef
        ?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    })
  }

  const activeOption = () => options().find((option) => option.key === store.active)

  const selectActive = () => {
    const option = activeOption()

    if (option) controller.select(option.item)
  }

  function ModelRows(rowProps: { items: ModelOption[] }) {
    return (
      <SettingsList variant="catalog">
        <For each={rowProps.items}>
          {(option) => (
            <>
              <div data-slot="model-row" class="group relative">
                <button
                  type="button"
                  data-component="settings-row"
                  data-option-key={option.key}
                  aria-pressed={controller.current() === option.key}
                  class="-mx-4 w-[calc(100%+32px)] px-4 text-start hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  classList={{ "bg-foreground/10": store.active === option.key }}
                  onMouseEnter={() => setStore("active", option.key)}
                  onMouseLeave={() => setStore("active", "")}
                  onClick={() => controller.select(option.item)}
                >
                  <div data-slot="settings-row-copy">
                    <div data-slot="settings-row-title" class="flex items-center gap-2">
                      <Tooltip
                        inactive={props.mobile}
                        placement="right-start"
                        gutter={12}
                        openDelay={0}
                        value={
                          <ModelTooltip
                            model={option.item}
                            latest={option.item.latest}
                            free={option.footer === "Free"}
                            v2
                          />
                        }
                      >
                        <span class="min-w-0 truncate">{option.title}</span>
                      </Tooltip>
                      <Show when={option.footer === "Free"}>
                        <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                      </Show>
                      <Show when={option.item.latest}>
                        <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                      </Show>
                    </div>
                    <div data-slot="settings-row-description" class="truncate">
                      {option.description}
                    </div>
                  </div>
                  <div data-slot="settings-row-control" class="flex items-center gap-1">
                    <span class="flex size-4 items-center justify-center">
                      <Show when={controller.current() === option.key}>
                        <Icon name="check" size="small" class="shrink-0 text-foreground" />
                      </Show>
                    </span>
                    <span class="w-7 shrink-0" aria-hidden="true" />
                  </div>
                </button>
                <FavoriteButton
                  class="absolute end-0 top-1/2 -translate-y-1/2"
                  mobile={props.mobile}
                  favorite={controller.favorite(option)}
                  onToggle={() => controller.toggleFavorite(option)}
                />
              </div>
              <Show when={controller.offers(option.item).length > 0}>
                <button
                  type="button"
                  data-component="settings-row"
                  class="-mx-4 w-[calc(100%+32px)] px-4 ps-8 text-start hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  aria-expanded={Boolean(store.offers[option.key])}
                  onClick={() => setStore("offers", option.key, (value) => !value)}
                >
                  <div data-slot="settings-row-copy">
                    <div data-slot="settings-row-title" class="flex items-center gap-2 text-ink-muted">
                      <Icon name={store.offers[option.key] ? "chevron-down" : "chevron-right"} size="small" />
                      <span class="min-w-0 truncate">
                        {language.plural("model.offers.count", controller.offers(option.item).length)}
                      </span>
                    </div>
                  </div>
                </button>
                <Show when={store.offers[option.key]}>
                  <For each={controller.offers(option.item)}>
                    {(entry) => (
                      <button
                        type="button"
                        data-component="settings-row"
                        class="-mx-4 w-[calc(100%+32px)] px-4 ps-12 text-start hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
                        disabled={!entry.model}
                        onClick={() => {
                          if (entry.model) controller.select(entry.model)
                        }}
                      >
                        <div data-slot="settings-row-copy">
                          <div data-slot="settings-row-title" class="flex items-center gap-2">
                            <span class="min-w-0 truncate">{Router.offerRoute(entry.offer)}</span>
                          </div>
                          <div data-slot="settings-row-description">{controller.offerDetails(entry)}</div>
                        </div>
                        <div data-slot="settings-row-control" class="size-4">
                          <Show when={entry.model && controller.current() === modelKey(entry.model)}>
                            <Icon name="check" size="small" class="shrink-0 text-foreground" />
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </>
          )}
        </For>
      </SettingsList>
    )
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div data-slot="model-selector-search" class="shrink-0 pt-px pb-3" classList={{ "px-4": !props.mobile }}>
        <TextInput
          type="search"
          appearance="base"
          class="!w-full self-stretch"
          placeholder={language.t("dialog.model.search.placeholder")}
          value={store.search}
          autofocus={!props.mobile}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (isModKey(event) && !event.altKey && event.key.toLowerCase() === "f") {
              event.preventDefault()
              const option = activeOption()

              if (option) controller.toggleFavorite(option)

              return
            }

            if (event.altKey || event.metaKey) return

            if (event.key === "ArrowDown") {
              event.preventDefault()
              moveActive(1)

              return
            }

            if (event.key === "ArrowUp") {
              event.preventDefault()
              moveActive(-1)

              return
            }

            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              selectActive()
            }
          }}
          aria-label={language.t("dialog.model.search.placeholder")}
          showClearButton={!!store.search}
          clearIcon="circle-xmark"
          clearLabel={language.t("common.clear")}
          onClearClick={() => setSearch("")}
        />
      </div>
      <div class="relative min-h-0" classList={{ "flex-1": !props.mobile }}>
        <div
          ref={(element) => (scrollRef = element)}
          class="settings-panel settings-models pt-1 pb-4"
          classList={{ "h-full px-4": !props.mobile, "max-h-[min(360px,40dvh)]": props.mobile }}
        >
          <Show
            when={options().length > 0}
            fallback={<div class="settings-models-status">{language.t("dialog.model.empty")}</div>}
          >
            <div class="flex flex-col gap-4">
              <For each={sections()}>
                {(section) => (
                  <section class="flex flex-col gap-2" data-section={section.key}>
                    <Show when={section.title}>
                      {(title) => (
                        <h3 class="m-0 flex items-center gap-2 text-eyebrow uppercase text-ink-muted">
                          <Show
                            when={section.provider}
                            fallback={<Show when={section.icon}>{(icon) => <Icon name={icon()} size="small" />}</Show>}
                          >
                            {(provider) => <ProviderModelIcon provider={provider()} class="shrink-0" />}
                          </Show>
                          <span class="min-w-0 truncate">{title()}</span>
                        </h3>
                      )}
                    </Show>
                    <ModelRows items={section.items} />
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Popover.Trigger>, "as" | "ref">

type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  unpaid?: boolean
  trigger: ModelSelectorTrigger
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
          trigger={props.trigger}
          controller={controller}
          chatgptPlan={chatgptPlan()}
          onManage={manage}
          onConnect={connect}
          onClose={() => props.onClose?.()}
        />
      }
    >
      <ModelSelectorDrawer
        trigger={props.trigger}
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
              <div class="flex min-h-0 flex-col">
                <ModelList mobile open={store.open} controller={controller} />
              </div>
              <div data-slot="model-selector-actions" class="flex flex-col gap-2">
                <Button
                  variant="ghost"
                  class="w-full !h-10 !justify-start"
                  icon="outline-sliders"
                  onClick={() => setStore({ open: false, action: "manage", restoreTrigger: false })}
                >
                  {language.t("dialog.model.manage")}
                </Button>
                <Show when={props.onConnect}>
                  <Button
                    variant="ghost"
                    class="w-full !h-10 !justify-start"
                    icon="plus"
                    onClick={() => setStore({ open: false, action: "connect", restoreTrigger: false })}
                  >
                    {language.t("command.provider.connect")}
                  </Button>
                </Show>
                <Show when={props.chatgptPlan}>
                  <div class="flex min-h-10 items-center gap-2 border-t border-muted px-3 py-2 text-[13px] leading-5 text-foreground">
                    <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
                    <ExternalLink
                      href="https://chatgpt.com/settings/usage"
                      class="flex shrink-0 items-center gap-1 rounded-sm text-ink-muted no-underline hover:text-foreground focus-visible:outline focus-visible:outline-2"
                    >
                      {language.t("dialog.model.chatgptManageUsage")}
                      <Icon name="arrow-up-right" size="small" />
                    </ExternalLink>
                  </div>
                </Show>
              </div>
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

  const sections = (search: string): ModelSection[] =>
    modelSections(options(), {
      search,
      favorites: models.favorite.list(),
      recent: models.recent.list(),
      provider: input.provider(),
    }).map((section) => {
      if (section.kind === "favorites")
        return { ...section, title: language.t("dialog.model.section.favorites"), icon: "star" }

      if (section.kind === "recent")
        return { ...section, title: language.t("dialog.model.section.recent"), icon: "reset" }

      if (section.kind === "route")
        return { ...section, title: section.category, provider: section.items[0].item.provider }

      return section
    })

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
    sections,
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
  trigger: ModelSelectorTrigger
  controller: ModelSelectorController
  chatgptPlan?: boolean
  onManage: () => void
  onConnect: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "", offers: {} as Record<string, boolean> })
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  const sections = createMemo(() => props.controller.sections(store.search))
  const options = createMemo(() => sections().flatMap((section) => section.items))
  const keys = () => [...options().map((option) => option.key), refreshKey, connectKey, manageKey]

  const initialActive = () => {
    const selected = props.controller.current()
    const values = keys()

    if (selected && values.includes(selected)) return selected

    return values[0] ?? ""
  }

  const activeItem = () =>
    store.active ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`) : undefined

  const setOpen = (open: boolean) => {
    if (open) {
      dismiss.allowTriggerRestore()
      setStore({ open: true, active: initialActive() })
      setTimeout(() =>
        requestAnimationFrame(() => {
          searchRef?.focus()
          activeItem()?.scrollIntoView({ block: "nearest" })
        }),
      )

      return
    }

    setStore({ open: false, search: "", active: "" })
  }

  const selectModel = (item: ModelItem) => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(() => props.controller.select(item))
  }

  const closeThen = (action: () => void) => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(action)
  }

  const selectActive = () => {
    const option = options().find((option) => option.key === store.active)

    if (option) {
      selectModel(option.item)

      return
    }

    if (store.active === refreshKey) void props.controller.refresh()

    if (store.active === connectKey) closeThen(props.onConnect)

    if (store.active === manageKey) closeThen(props.onManage)
  }

  const moveActive = (delta: number) => {
    const values = keys()

    if (values.length === 0) return
    const index = values.indexOf(store.active)
    const start = index === -1 ? 0 : index
    setStore("active", values[(start + delta + values.length) % values.length])
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }

  const setSearch = (value: string) => {
    const first = props.controller
      .sections(value)
      .flatMap((section) => section.items)
      .at(0)
    setStore({ search: value, active: first?.key ?? manageKey })
  }

  createEffect(() => {
    if (!store.open) return
    createEventListener(
      document,
      "keydown",
      (event: KeyboardEvent) => handleDocumentSearchKeydown(searchRef, event, store.search, setSearch),
      true,
    )
  })

  const hover = (key: string) => {
    setStore("active", key)
    setTimeout(() => searchRef?.focus())
  }

  return (
    <Menu open={store.open} modal={false} placement="top-start" gutter={6} onOpenChange={setOpen}>
      <Menu.Trigger as={props.trigger} />
      <Menu.Portal>
        <Menu.Content
          ref={(element: HTMLDivElement) => (contentRef = element)}
          class="w-[340px] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none"
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-1 text-ink-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(el) => (searchRef = el)}
                value={store.search}
                placeholder={language.t("dialog.model.search.placeholder")}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-normal leading-5 text-foreground outline-none placeholder:text-ink-muted"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") return
                  event.stopPropagation()

                  if (event.key === "Escape") {
                    event.preventDefault()
                    closeThen(props.onClose)

                    return
                  }

                  if (isModKey(event) && !event.altKey && event.key.toLowerCase() === "f") {
                    event.preventDefault()
                    const option = options().find((option) => option.key === store.active)

                    if (option) props.controller.toggleFavorite(option)

                    return
                  }

                  if (event.altKey || event.metaKey) return

                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)

                    return
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)

                    return
                  }

                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    selectActive()
                  }
                }}
              />
              <Show when={store.search.trim()}>
                <button
                  type="button"
                  class="flex size-5 items-center justify-center rounded-sm bg-transparent text-ink-muted transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:text-foreground active:text-foreground"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  aria-label={language.t("common.clear")}
                >
                  <Icon name="circle-xmark" />
                </button>
              </Show>
            </div>
          </div>
          <div class="h-px bg-muted" />
          <ScrollView data-slot="model-selector-scroll" class="max-h-[320px] min-h-0">
            <div class="flex flex-col p-0.5 pt-0">
              <Show
                when={options().length > 0}
                fallback={
                  <div class="flex h-12 items-center px-3 text-[13px] font-normal leading-5 text-ink-muted">
                    {language.t("dialog.model.empty")}
                  </div>
                }
              >
                <For each={sections()}>
                  {(section) => (
                    <Menu.Group>
                      <Show when={section.title}>
                        {(title) => (
                          <Menu.GroupLabel class="gap-2 px-3">
                            <Show
                              when={section.provider}
                              fallback={
                                <Show when={section.icon}>{(icon) => <Icon name={icon()} size="small" />}</Show>
                              }
                            >
                              {(provider) => <ProviderModelIcon provider={provider()} class="shrink-0" />}
                            </Show>
                            <span class="min-w-0 truncate">{title()}</span>
                          </Menu.GroupLabel>
                        )}
                      </Show>
                      <Menu.RadioGroup value={props.controller.current()}>
                        <For each={section.items}>
                          {(option) => (
                            <>
                              <div class="group relative">
                                <Tooltip
                                  class="w-full"
                                  placement="right-start"
                                  gutter={6}
                                  openDelay={0}
                                  value={
                                    <ModelTooltip
                                      model={option.item}
                                      latest={option.item.latest}
                                      free={option.footer === "Free"}
                                      v2
                                    />
                                  }
                                >
                                  <Menu.RadioItem
                                    value={option.key}
                                    data-option-key={option.key}
                                    data-selected-model={props.controller.current() === option.key ? true : undefined}
                                    class="scroll-my-6 w-full !h-auto min-h-7 py-1 pe-9"
                                    classList={{ "!bg-foreground/10": store.active === option.key }}
                                    onMouseEnter={() => hover(option.key)}
                                    onSelect={() => selectModel(option.item)}
                                  >
                                    <span class="flex min-w-0 flex-1 flex-col">
                                      <span class="flex min-w-0 items-center gap-2">
                                        <span class="min-w-0 truncate leading-5">{option.title}</span>
                                        <Show when={option.footer === "Free"}>
                                          <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                                        </Show>
                                        <Show when={option.item.latest}>
                                          <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                                        </Show>
                                      </span>
                                      <span class="min-w-0 truncate text-[12px] leading-4 text-ink-muted">
                                        {option.description}
                                      </span>
                                    </span>
                                  </Menu.RadioItem>
                                </Tooltip>
                                <FavoriteButton
                                  class="absolute end-1 top-1/2 -translate-y-1/2"
                                  favorite={props.controller.favorite(option)}
                                  onToggle={() => {
                                    props.controller.toggleFavorite(option)
                                    searchRef?.focus()
                                  }}
                                />
                              </div>
                              <Show when={props.controller.offers(option.item).length > 0}>
                                <Menu.Item
                                  closeOnSelect={false}
                                  class="w-full ps-6"
                                  aria-expanded={Boolean(store.offers[option.key])}
                                  onSelect={() => setStore("offers", option.key, (value) => !value)}
                                >
                                  <Icon
                                    name={store.offers[option.key] ? "chevron-down" : "chevron-right"}
                                    size="small"
                                  />
                                  <span class="min-w-0 truncate leading-5">
                                    {language.plural("model.offers.count", props.controller.offers(option.item).length)}
                                  </span>
                                </Menu.Item>
                                <Show when={store.offers[option.key]}>
                                  <For each={props.controller.offers(option.item)}>
                                    {(entry) => (
                                      <Menu.Item
                                        class="w-full ps-9"
                                        disabled={!entry.model}
                                        title={props.controller.offerDetails(entry)}
                                        onSelect={() => {
                                          if (entry.model) selectModel(entry.model)
                                        }}
                                      >
                                        <span class="min-w-0 flex-1 truncate leading-5">
                                          {Router.offerRoute(entry.offer)}
                                        </span>
                                        <span class="shrink-0 truncate leading-5 text-ink-muted">
                                          {props.controller.offerDetails(entry)}
                                        </span>
                                      </Menu.Item>
                                    )}
                                  </For>
                                </Show>
                              </Show>
                            </>
                          )}
                        </For>
                      </Menu.RadioGroup>
                    </Menu.Group>
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>
          <div class="h-px bg-muted" />
          <div class="flex flex-col p-0.5">
            <Menu.Item
              data-option-key={refreshKey}
              closeOnSelect={false}
              disabled={props.controller.refreshing()}
              classList={{ "!bg-foreground/10": store.active === refreshKey }}
              onMouseEnter={() => hover(refreshKey)}
              onSelect={() => void props.controller.refresh()}
            >
              <Icon name="reset" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">
                {language.t(props.controller.refreshing() ? "dialog.model.refresh.pending" : "dialog.model.refresh")}
              </span>
            </Menu.Item>
            <Menu.Item
              data-option-key={connectKey}
              classList={{ "!bg-foreground/10": store.active === connectKey }}
              onMouseEnter={() => hover(connectKey)}
              onSelect={() => closeThen(props.onConnect)}
            >
              <Icon name="plus" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">{language.t("command.provider.connect")}</span>
            </Menu.Item>
            <Menu.Item
              data-option-key={manageKey}
              classList={{ "!bg-foreground/10": store.active === manageKey }}
              onMouseEnter={() => hover(manageKey)}
              onSelect={() => closeThen(props.onManage)}
            >
              <Icon name="outline-sliders" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">{language.t("dialog.model.manage")}</span>
            </Menu.Item>
          </div>
          <Show when={props.chatgptPlan}>
            <div class="h-px bg-muted" />
            <div class="flex min-h-10 items-center gap-2 px-3 py-2 text-[13px] leading-5 text-foreground">
              <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
              <ExternalLink
                href="https://chatgpt.com/settings/usage"
                class="flex shrink-0 items-center gap-1 rounded-sm text-ink-muted no-underline hover:text-foreground focus-visible:outline focus-visible:outline-2"
              >
                {language.t("dialog.model.chatgptManageUsage")}
                <Icon name="arrow-up-right" size="small" />
              </ExternalLink>
            </div>
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
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

  return (
    <Dialog size="large" variant="settings">
      <Show
        when={!store.variants}
        fallback={<VariantList model={model} title={language.t("dialog.model.variant.title")} />}
      >
        <ModelSelectDialogBody
          provider={props.provider}
          model={props.model}
          onSelect={chosen}
          onConnect={connect}
          onManage={manage}
        />
      </Show>
    </Dialog>
  )
}

function ModelSelectDialogBody(props: {
  provider?: string
  model?: ModelState
  onSelect: (item: ModelItem) => void
  onConnect: () => void
  onManage: () => void
}) {
  const language = useLanguage()
  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: props.onSelect,
  })

  return (
    <>
      <DialogHeader hideClose closeLabel={language.t("common.close")}>
        <DialogTitleGroup title={language.t("dialog.model.select.title")} />
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            icon="reset"
            disabled={controller.refreshing()}
            aria-busy={controller.refreshing()}
            onClick={() => void controller.refresh()}
          >
            {language.t(controller.refreshing() ? "dialog.model.refresh.pending" : "dialog.model.refresh")}
          </Button>
          <Button icon="plus" onClick={props.onConnect}>
            {language.t("command.provider.connect")}
          </Button>
        </div>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <ModelList controller={controller} />
        <div class="flex shrink-0 items-center gap-3 border-t border-muted px-4 py-3">
          <button
            type="button"
            class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium leading-text-compact text-foreground hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={props.onManage}
          >
            <Icon name="outline-sliders" size="small" />
            <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.manage")}</span>
          </button>
          <span class="shrink-0 text-[12px] leading-4 text-ink-muted">{language.t("dialog.model.favorite.hint")}</span>
        </div>
      </DialogBody>
    </>
  )
}

/** The variant step after choosing a model with variants; `Default` keeps the provider's own setting. */
function VariantList(props: { model: ModelState; title: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const current = () => props.model.variant.current() ?? "default"

  return (
    <>
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitleGroup title={props.title} description={props.model.current()?.name} />
      </DialogHeader>
      <DialogBody class="settings-panel settings-models flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        <SettingsList variant="catalog">
          <For each={["default", ...props.model.variant.list()]}>
            {(variant) => (
              <button
                type="button"
                data-component="settings-row"
                aria-pressed={current() === variant}
                class="-mx-4 w-[calc(100%+32px)] px-4 text-start hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                ref={(element) => {
                  if (variant === "default") queueMicrotask(() => element.focus())
                }}
                onClick={() => {
                  props.model.variant.set(variant === "default" ? undefined : variant)
                  dialog.close()
                }}
              >
                <div data-slot="settings-row-copy">
                  <div data-slot="settings-row-title">
                    {variant === "default" ? language.t("dialog.model.variant.default") : variant}
                  </div>
                </div>
                <div data-slot="settings-row-control" class="size-4">
                  <Show when={current() === variant}>
                    <Icon name="check" size="small" class="shrink-0 text-foreground" />
                  </Show>
                </div>
              </button>
            )}
          </For>
        </SettingsList>
      </DialogBody>
    </>
  )
}
