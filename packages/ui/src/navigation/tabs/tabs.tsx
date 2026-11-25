import { Content, List, Root, Trigger, useTabsContext } from "@kobalte/core/tabs"
import { createContext, Show, splitProps, useContext, type JSX } from "solid-js"
import type { Component, ComponentProps, ParentProps } from "solid-js"
import { Icon } from "../../icons/icon/icon"
import { useI18n } from "../../context/i18n"
import { tabs } from "@reddb-io/design-system/contracts/tabs"
import { button } from "@reddb-io/design-system/contracts/button"

export type TabsVariant = "panel" | "underline" | "surface" | "line" | "pill" | "settings"

export interface TabsProps extends ComponentProps<typeof Root> {
  variant?: TabsVariant
  orientation?: "horizontal" | "vertical"
}

export interface TabsListProps extends ComponentProps<typeof List> {}

export interface TabsTriggerProps extends ComponentProps<typeof Trigger> {
  classes?: { button?: string }
  closeButton?: JSX.Element
  hideCloseButton?: boolean
  onMiddleClick?: () => void
  subtext?: JSX.Element | string
}

export interface TabsCloseButtonProps extends ComponentProps<"button"> {}

export interface TabsContentProps extends ComponentProps<typeof Content> {}

const slots = tabs({ size: "sm", overflow: "scroll" })
const TabsContext = createContext({ current: (): boolean => false, vertical: (): boolean => false })

function TabsRoot(props: TabsProps) {
  const [local, rest] = splitProps(props, ["class", "classList", "variant", "orientation", "children"])
  const variant = () => local.variant ?? "panel"
  const current = () => variant() === "line" || variant() === "pill" || variant() === "settings"

  const dataVariant = () => {
    if (variant() === "panel" || variant() === "line") return "normal"

    if (variant() === "underline") return "alt"

    if (variant() === "surface") return "pill"

    return variant()
  }

  return (
    <TabsContext.Provider value={{ current, vertical: () => local.orientation === "vertical" }}>
      <Root
        {...rest}
        orientation={local.orientation}
        data-component={current() ? "tabs-v2" : "tabs"}
        data-variant={dataVariant()}
        data-orientation={local.orientation || "horizontal"}
        class={slots.root({
          class: ["flex size-full min-h-0 overflow-clip", local.orientation !== "vertical" && "flex-col", local.class],
        })}
        classList={local.classList}
      >
        {local.children}
      </Root>
    </TabsContext.Provider>
  )
}

function TabsList(props: TabsListProps) {
  const ctx = useContext(TabsContext)
  const [local, rest] = splitProps(props, ["class", "classList"])

  return (
    <List
      {...rest}
      data-slot={ctx.current() ? "tabs-v2-list" : "tabs-list"}
      class={slots.list({
        class: [
          "min-w-0 shrink-0",
          ctx.vertical() ? "flex-col items-stretch overflow-y-auto border-b-0 border-e" : "w-full items-end",
          local.class,
        ],
      })}
      classList={local.classList}
    />
  )
}

function TabsTrigger(props: ParentProps<TabsTriggerProps>) {
  const ctx = useContext(TabsContext)

  const [local, rest] = splitProps(props, [
    "class",
    "classList",
    "classes",
    "children",
    "closeButton",
    "hideCloseButton",
    "onMiddleClick",
    "subtext",
    "dir",
  ])

  const selection = useTabsContext()
  const wrapperSlot = () => (ctx.current() ? "tabs-v2-trigger-wrapper" : "tabs-trigger-wrapper")
  const triggerSlot = () => (ctx.current() ? "tabs-v2-trigger" : "tabs-trigger")
  const closeSlot = () => (ctx.current() ? "tabs-v2-trigger-close-button" : "tabs-trigger-close-button")

  return (
    <div
      data-slot={wrapperSlot()}
      data-value={props.value}
      class={`relative flex min-w-0 max-w-80 shrink-0 items-center ${local.class ?? ""}`}
      classList={local.classList}
      onMouseDown={(event) => {
        if (event.button !== 1 || !local.onMiddleClick) return
        event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !local.onMiddleClick) return
        event.preventDefault()
        local.onMiddleClick()
      }}
    >
      <Trigger
        {...rest}
        dir={local.dir ?? "auto"}
        data-slot={triggerSlot()}
        data-value={props.value}
        data-state={selection.listState().selectedKey() === props.value ? "active" : "inactive"}
        class={button({
          variant: "ghost",
          size: "sm",
          class: slots.trigger({
            class: [
              "min-w-0 shrink truncate text-start",
              ctx.vertical() && "w-full justify-start rounded-s-none border-b-0 border-s-2",
              local.classes?.button,
            ],
          }),
        })}
      >
        <Show when={ctx.current()} fallback={local.children}>
          <span
            class="inline-flex min-w-0 items-center gap-[var(--reddb-spatial-gap-sm)] overflow-hidden"
            data-slot="tabs-v2-trigger-content"
          >
            {local.children}
            <Show when={local.subtext}>
              {(subtext) => (
                <span data-slot="tabs-v2-subtext" class="ms-2 text-caption text-ink-muted">
                  {subtext()}
                </span>
              )}
            </Show>
          </span>
        </Show>
      </Trigger>
      <Show when={local.closeButton}>
        {(closeButton) => (
          <div
            class="flex shrink-0 items-center"
            data-slot={closeSlot()}
            data-hidden={local.hideCloseButton ? "" : undefined}
          >
            {closeButton()}
          </div>
        )}
      </Show>
    </div>
  )
}

function TabsCloseButton(props: TabsCloseButtonProps) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, ["class", "classList", "onClick", "onPointerDown", "aria-label"])

  return (
    <button
      type="button"
      {...rest}
      aria-label={local["aria-label"] ?? i18n.t("ui.tabs.close")}
      data-slot="tabs-close-button"
      class={button({
        variant: "ghost",
        size: "sm",
        class: ["aspect-square shrink-0 px-0 focus-visible:-outline-offset-2", local.class],
      })}
      classList={local.classList}
      onPointerDown={(event) => {
        event.stopPropagation()

        if (typeof local.onPointerDown === "function") local.onPointerDown(event)
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (typeof local.onClick === "function") local.onClick(event)
      }}
    >
      <Icon name="outline-xmark" size="small" aria-hidden="true" />
    </button>
  )
}

function TabsContent(props: ParentProps<TabsContentProps>) {
  const ctx = useContext(TabsContext)
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <Content
      {...rest}
      data-slot={ctx.current() ? "tabs-v2-content" : "tabs-content"}
      class={slots.content({
        class: ["min-h-0 min-w-0 flex-1 overflow-auto py-0 focus-visible:-outline-offset-2", local.class],
      })}
      classList={local.classList}
    >
      {local.children}
    </Content>
  )
}

const TabsSectionTitle: Component<ParentProps> = (props) => {
  const ctx = useContext(TabsContext)

  return (
    <div
      class="px-[var(--reddb-spatial-inset-sm)] text-eyebrow uppercase text-ink-muted"
      data-slot={ctx.current() ? "tabs-v2-section-title" : "tabs-section-title"}
    >
      {props.children}
    </div>
  )
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  CloseButton: TabsCloseButton,
  Content: TabsContent,
  SectionTitle: TabsSectionTitle,
})
