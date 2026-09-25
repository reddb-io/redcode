import { Popover as Kobalte } from "@kobalte/core/popover"
import { Router } from "@reddb-io/redcode-schema/router"
import { Component, ComponentProps, createEffect, createMemo, For, JSX, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@reddb-io/redcode-ui/button"
import { IconButton } from "@reddb-io/redcode-ui/icon-button"
import { ScrollView } from "@reddb-io/redcode-ui/scroll-view"
import { Tag } from "@reddb-io/redcode-ui/tag"
import { Dialog } from "@reddb-io/redcode-ui/dialog"
import { List } from "@reddb-io/redcode-ui/list"
import { Tooltip } from "@reddb-io/redcode-ui/tooltip"
import { Icon } from "@reddb-io/redcode-ui/v2/icon"
import { Tag as TagV2 } from "@reddb-io/redcode-ui/v2/badge-v2"
import { MenuV2 } from "@reddb-io/redcode-ui/v2/menu-v2"
import { TooltipV2 } from "@reddb-io/redcode-ui/v2/tooltip-v2"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { handleDocumentSearchKeydown } from "@/utils/search-keydown"
import { createMenuDismissController } from "@/utils/menu-dismiss-controller"
import { createEventListener } from "@solid-primitives/event-listener"
import { matchesModelSearch } from "./dialog-select-model-search"
import {
  flatOffers,
  modelAlternatives,
  modelGroup,
  modelKey,
  modelOrigin,
  routerPath,
  type ModelAlternatives,
} from "./model-origin"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]
type ModelItem = ReturnType<ModelState["list"]>[number]

const manageKey = "action:manage"

const sortModelGroups = (a: { category: string; items: ModelItem[] }, b: { category: string; items: ModelItem[] }) => {
  const aIndex = popularProviders.indexOf(a.items[0].provider.id)
  const bIndex = popularProviders.indexOf(b.items[0].provider.id)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0

  if (aPopular && !bPopular) return -1
  if (!aPopular && bPopular) return 1
  if (aPopular && bPopular) return aIndex - bIndex
  return modelGroup(a.items[0]).label.localeCompare(modelGroup(b.items[0]).label)
}

const visibleModels = (model: ModelState) =>
  model.list().filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))

/** `direct`, or `via RedRouter » OpenAI Codex · subscription`, plus where else the same model is offered. */
function originLabel(
  language: ReturnType<typeof useLanguage>,
  item: ModelItem,
  alternatives: ModelAlternatives | undefined,
) {
  return [
    ...originRoute(language, modelOrigin(item)),
    ...(alternatives?.direct ? [language.t("model.origin.alsoDirect")] : []),
    ...(alternatives?.routers ?? []).map((router) => language.t("model.origin.alsoVia", { router })),
  ].join(" · ")
}

/** The route segment: `direct`, or `via RedRouter » OpenAI Codex` with the upstream joined as a hop. */
function originRoute(language: ReturnType<typeof useLanguage>, origin: ReturnType<typeof modelOrigin>) {
  if (origin.type === "direct") return [language.t("model.origin.direct")]
  const via = language.t("model.origin.via", { router: routerPath(origin) })
  return [
    origin.upstream ? `${via}${Router.HOP_SEPARATOR}${origin.upstream}` : via,
    ...(origin.subscription ? [language.t("model.origin.subscription")] : []),
  ]
}

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()

  const visible = createMemo(() => visibleModels(model))
  // A pinned offer of a flat model is listed under that model (see the offers below), not on its own.
  const models = createMemo(() =>
    visible().filter((m) => !m.pinOf && (props.provider ? m.provider.id === props.provider : true)),
  )
  const alternatives = createMemo(() => modelAlternatives(visible()))
  // Flat models whose offers are shown, by `modelKey`.
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const pinnable = (item: ModelItem) => (id: string) =>
    model.list().some((entry) => entry.id === id && entry.provider.id === item.provider.id)

  return (
    <List
      class={`flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
      filterKeys={["provider.name", "upstream.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => modelGroup(x).label}
      sortGroupsBy={(a, b) => {
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      itemWrapper={(item, node) => (
        <Tooltip
          class="w-full"
          placement="right-start"
          gutter={12}
          openDelay={0}
          value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
        >
          {node}
        </Tooltip>
      )}
      onSelect={(x) => {
        model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex flex-col">
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
          <For each={i.modes ?? []}>{(mode) => <Tag>{mode}</Tag>}</For>
          <span class="ml-auto min-w-0 truncate text-12-regular text-text-weak">
            {originLabel(language, i, alternatives().get(modelKey(i)))}
          </span>
          <Show when={i.flat && i.offers?.length}>
            <IconButton
              icon={expanded[modelKey(i)] ? "chevron-down" : "chevron-right"}
              variant="ghost"
              iconSize="normal"
              class="size-5 shrink-0"
              aria-label={language.t("model.flat.offers")}
              aria-expanded={!!expanded[modelKey(i)]}
              onClick={(event) => {
                event.stopPropagation()
                setExpanded(modelKey(i), (open) => !open)
              }}
            />
          </Show>
        </div>
        <Show when={expanded[modelKey(i)]}>
          <div class="flex flex-col pl-4 pt-1">
            <For each={flatOffers(i, pinnable(i))}>
              {(row) => (
                <button
                  type="button"
                  class="w-full flex items-center gap-x-2 py-0.5 text-12-regular text-left disabled:opacity-50"
                  disabled={!row.pin}
                  title={row.pin ? language.t("model.flat.pin") : language.t("model.flat.unpinnable")}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!row.pin) return
                    // The pin id, never the offer id: the vendor's own offer id can be the flat id itself.
                    model.set({ modelID: row.pin, providerID: i.provider.id }, { recent: true })
                    props.onSelect()
                  }}
                >
                  <span class="truncate">{row.route}</span>
                  <Show when={row.offer.free}>
                    <Tag>{language.t("model.tag.free")}</Tag>
                  </Show>
                  <Show when={!row.offer.available}>
                    <span class="text-text-weak">{language.t("model.flat.unavailable")}</span>
                  </Show>
                  <span class="ml-auto shrink-0 text-text-weak">{row.price}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  trigger: ModelSelectorTrigger
  onClose?: (cause: "escape" | "select") => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const dialog = useDialog()
  const local = useLocal()
  const directory = () => decode64(local.slug())

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleManage = () => {
    close("manage")
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  const handleConnectProvider = () => {
    close("provider")
    void import("./dialog-connect-provider").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider directory={directory} />)
    })
  }
  const language = useLanguage()

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.trigger} />
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            const dismiss = store.dismiss
            if (dismiss === "outside") event.preventDefault()
            if (dismiss === "escape" || dismiss === "select") {
              event.preventDefault()
              props.onClose?.(dismiss)
            }
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <ModelList
            provider={props.provider}
            model={props.model}
            onSelect={() => close("select")}
            class="p-1"
            action={
              <div class="flex items-center gap-1">
                <Tooltip placement="top" value={language.t("command.provider.connect")}>
                  <IconButton
                    icon="plus-small"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("command.provider.connect")}
                    onClick={handleConnectProvider}
                  />
                </Tooltip>
                <Tooltip placement="top" value={language.t("dialog.model.manage")}>
                  <IconButton
                    icon="sliders"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("dialog.model.manage")}
                    onClick={handleManage}
                  />
                </Tooltip>
              </div>
            }
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export function ModelSelectorPopoverV2(props: {
  provider?: string
  model?: ModelState
  trigger: ModelSelectorTrigger
  onClose?: () => void
}) {
  const dialog = useDialog()
  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => props.onClose?.(),
  })

  return (
    <ModelSelectorPopoverV2View
      trigger={props.trigger}
      models={controller.models}
      groups={controller.groups}
      origin={controller.origin}
      current={controller.current}
      select={controller.select}
      onManage={() => {
        void import("./dialog-manage-models").then((module) => {
          void dialog.show(() => <module.DialogManageModelsV2 />)
        })
      }}
      onClose={() => props.onClose?.()}
    />
  )
}

function createModelSelectorController(input: {
  provider: () => string | undefined
  model?: ModelState
  onSelect: () => void
}) {
  const model = input.model ?? useLocal().model
  const language = useLanguage()
  const visible = createMemo(() => visibleModels(model))
  const allModels = createMemo(() =>
    visible().filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
  )
  const alternatives = createMemo(() => modelAlternatives(visible()))

  return {
    models: (search: string) => {
      const query = search.trim()
      const filtered = query
        ? allModels().filter((item) =>
            matchesModelSearch(query, [item.name, item.id, item.provider.name, item.upstream?.name ?? ""]),
          )
        : allModels()
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    },
    groups: (models: ModelItem[]) => {
      const byGroup = new Map<string, ModelItem[]>()
      for (const item of models) {
        const key = modelGroup(item).key
        byGroup.set(key, [...(byGroup.get(key) ?? []), item])
      }
      return Array.from(byGroup, ([category, items]) => ({ category, items })).sort(sortModelGroups)
    },
    origin: (item: ModelItem) => originLabel(language, item, alternatives().get(modelKey(item))),
    current: () => {
      const value = model.current()
      return value ? modelKey(value) : undefined
    },
    select: (item: ModelItem) => {
      model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
      input.onSelect()
    },
  }
}

function ModelSelectorPopoverV2View(props: {
  trigger: ModelSelectorTrigger
  models: (search: string) => ModelItem[]
  groups: (models: ModelItem[]) => { category: string; items: ModelItem[] }[]
  origin: (item: ModelItem) => string
  current: () => string | undefined
  select: (item: ModelItem) => void
  onManage: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  const models = createMemo(() => props.models(store.search))
  const groups = createMemo(() => props.groups(models()))
  const keys = () => [...models().map(modelKey), manageKey]
  const initialActive = () => {
    const selected = props.current()
    const options = keys()
    if (selected && options.includes(selected)) return selected
    return options[0] ?? ""
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
    dismiss.afterClose(() => props.select(item))
  }
  const manage = () => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(props.onManage)
  }
  const selectActive = () => {
    const item = models().find((item) => modelKey(item) === store.active)
    if (item) {
      selectModel(item)
      return
    }
    if (store.active === manageKey) manage()
  }
  const moveActive = (delta: number) => {
    const options = keys()
    if (options.length === 0) return
    const index = options.indexOf(store.active)
    const start = index === -1 ? 0 : index
    setStore("active", options[(start + delta + options.length) % options.length])
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const setSearch = (value: string) => {
    const first = props.models(value)[0]
    setStore({ search: value, active: first ? modelKey(first) : manageKey })
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

  return (
    <MenuV2 open={store.open} modal={false} placement="top-start" gutter={6} onOpenChange={setOpen}>
      <MenuV2.Trigger as={props.trigger} />
      <MenuV2.Portal>
        <MenuV2.Content
          ref={(element: HTMLDivElement) => (contentRef = element)}
          class="w-[284px] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none"
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-2.5 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(el) => (searchRef = el)}
                value={store.search}
                placeholder={language.t("dialog.model.search.placeholder")}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
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
                    dismiss.preventTriggerRestore()
                    setOpen(false)
                    dismiss.afterClose(props.onClose)
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
                  class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  aria-label={language.t("common.clear")}
                >
                  <Icon name="close" size="small" />
                </button>
              </Show>
            </div>
          </div>
          <div class="h-px bg-v2-border-border-muted" />
          <ScrollView data-slot="model-selector-scroll" class="max-h-[220px] min-h-0">
            <div class="flex flex-col p-0.5 pt-0">
              <Show
                when={models().length > 0}
                fallback={
                  <div class="flex h-12 items-center px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                    {language.t("dialog.model.empty")}
                  </div>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <MenuV2.Group>
                      <MenuV2.GroupLabel class="sticky top-0 z-10 gap-2 bg-v2-background-bg-layer-01 px-3">
                        <span class="min-w-0 truncate">{modelGroup(group.items[0]).label}</span>
                      </MenuV2.GroupLabel>
                      <MenuV2.RadioGroup value={props.current()}>
                        <For each={group.items}>
                          {(item) => (
                            <TooltipV2
                              class="w-full"
                              placement="right-start"
                              gutter={6}
                              openDelay={0}
                              value={
                                <ModelTooltip
                                  model={item}
                                  latest={item.latest}
                                  free={isFree(item.provider.id, item.cost)}
                                  v2
                                />
                              }
                            >
                              <MenuV2.RadioItem
                                value={modelKey(item)}
                                data-option-key={modelKey(item)}
                                data-selected-model={props.current() === modelKey(item) ? true : undefined}
                                class="scroll-my-6 w-full"
                                classList={{ "!bg-v2-overlay-simple-overlay-hover": store.active === modelKey(item) }}
                                onMouseEnter={() => {
                                  setStore("active", modelKey(item))
                                  setTimeout(() => searchRef?.focus())
                                }}
                                onSelect={() => selectModel(item)}
                              >
                                <span class="min-w-0 truncate leading-5">{item.name}</span>
                                <Show when={isFree(item.provider.id, item.cost)}>
                                  <TagV2 class="shrink-0">{language.t("model.tag.free")}</TagV2>
                                </Show>
                                <Show when={item.latest}>
                                  <TagV2 class="shrink-0">{language.t("model.tag.latest")}</TagV2>
                                </Show>
                                <For each={item.modes ?? []}>{(mode) => <TagV2 class="shrink-0">{mode}</TagV2>}</For>
                                <span class="ml-auto min-w-0 truncate text-[12px] leading-5 text-v2-text-text-faint">
                                  {props.origin(item)}
                                </span>
                              </MenuV2.RadioItem>
                            </TooltipV2>
                          )}
                        </For>
                      </MenuV2.RadioGroup>
                    </MenuV2.Group>
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>
          <div class="h-px bg-v2-border-border-muted" />
          <div class="flex flex-col p-0.5">
            <MenuV2.Item
              data-option-key={manageKey}
              classList={{ "!bg-v2-overlay-simple-overlay-hover": store.active === manageKey }}
              onMouseEnter={() => {
                setStore("active", manageKey)
                setTimeout(() => searchRef?.focus())
              }}
              onSelect={manage}
            >
              <Icon name="outline-sliders" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">{language.t("dialog.model.manage")}</span>
            </MenuV2.Item>
          </div>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const directory = () => decode64(local.slug())

  const provider = () => {
    void import("./dialog-connect-provider").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider directory={directory} />)
    })
  }

  const manage = () => {
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={provider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
      <Button variant="ghost" class="ml-3 mt-5 mb-6 text-text-base self-start" onClick={manage}>
        {language.t("dialog.model.manage")}
      </Button>
    </Dialog>
  )
}
