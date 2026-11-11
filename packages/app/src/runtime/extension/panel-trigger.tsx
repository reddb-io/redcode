import { createMemo, Match, Show, Switch, untrack } from "solid-js"
import type { JSX } from "solid-js"
import { useSortable } from "@dnd-kit/solid/sortable"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Tabs } from "@opencode/ui/tabs"
import { Menu } from "@opencode/ui/menu"
import type { MountedSession, PanelTab } from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { Contribution } from "./render"

/** One side panel tab trigger. The extension supplies the content; the host owns close, drag, and ids. */
export function PanelTrigger(props: {
  value: string
  extension: string
  tab: PanelTab
  session: MountedSession
  index: number
  active: boolean
  preview: boolean
  siblings: readonly { key: string; tab: PanelTab }[]
  onClose: (value: string) => void
  onCloseMany: (values: readonly string[]) => void
  onPromote: (value: string) => void
}): JSX.Element {
  const language = useLanguage()
  const command = useCommand()
  const closeKeybind = createMemo(() => command.keybindParts("file.close"))
  const targets = (scope: "others" | "all" | "left" | "right") => {
    const index = props.siblings.findIndex((entry) => entry.key === props.value)

    if (index < 0) return []
    return props.siblings.flatMap((entry, position) => {
      if (entry.tab.pinned || entry.tab.closable === false) return []
      if (scope === "others" && entry.key === props.value) return []
      if (scope === "left" && position >= index) return []
      if (scope === "right" && position <= index) return []
      return [entry.key]
    })
  }

  // The label renders once per label function; state is read through getters so neither selection nor a session
  // switch remounts it.
  const state = {
    get active() {
      return props.active
    },
    get preview() {
      return props.preview
    },
    get session() {
      return props.session
    },
  }

  const label = createMemo(() => props.tab.label)

  const rendered = createMemo(() => {
    const render = label()

    if (!render) return

    return <Contribution extension={props.extension}>{() => untrack(() => render(state))}</Contribution>
  })

  const content = () => rendered() ?? props.tab.title

  const tooltip = (button: JSX.Element) => (
    <Tooltip
      value={
        <>
          {language.t("common.closeTab")}
          <Show when={closeKeybind().length > 0}>
            <Keybind keys={closeKeybind()} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      gutter={10}
    >
      {button}
    </Tooltip>
  )

  const closeButton = (reveal: boolean) =>
    tooltip(
      <IconButton
        size="small"
        variant="ghost-muted"
        class={reveal ? "hover-reveal relative z-10 group-hover:opacity-100" : undefined}
        classList={reveal ? { "opacity-100": props.active } : undefined}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onClose(props.value)
        }}
        icon={<Icon name="xmark-small" />}
        aria-label={language.t("common.closeTab")}
      />,
    )

  const compactClose = () =>
    tooltip(<Tabs.CloseButton onClick={() => props.onClose(props.value)} aria-label={language.t("common.closeTab")} />)

  // The close button `closable` asks for; a plain one by default.
  const close = () => {
    const closable = props.tab.closable

    if (closable === false) return undefined

    if (closable === "compact") return compactClose()

    return closeButton(closable === "hover")
  }

  // Construct tabs under their own collection context. Kobalte's Menu also provides a list
  // context, which must not replace the Tabs context used for click and keyboard selection.
  const trigger = (
    <Switch fallback={<SortableTrigger {...props} content={content()} close={close()} />}>
      <Match when={props.tab.pinned}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          aria-controls={props.active ? props.tab.dom?.panel : undefined}
        >
          {content()}
        </Tabs.Trigger>
      </Match>
      <Match when={props.tab.draggable === false && props.tab.closable === "compact"}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          onMiddleClick={() => props.onClose(props.value)}
          closeButton={compactClose()}
          hideCloseButton
        >
          {content()}
        </Tabs.Trigger>
      </Match>
      <Match when={props.tab.draggable === false}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          class="group"
          onMiddleClick={props.tab.closable === false ? undefined : () => props.onClose(props.value)}
          closeButton={close()}
          hideCloseButton
        >
          {content()}
        </Tabs.Trigger>
      </Match>
    </Switch>
  )

  return (
    <Menu.Context>
      <Menu.Context.Trigger as="div" class="h-full flex shrink-0" tabIndex={-1}>
        {trigger}
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Menu.Item
            disabled={props.tab.pinned || props.tab.closable === false}
            onSelect={() => props.onClose(props.value)}
          >
            {language.t("common.closeTab")}
          </Menu.Item>
          <Menu.Item disabled={targets("others").length === 0} onSelect={() => props.onCloseMany(targets("others"))}>
            {language.t("workbench.tabs.closeOthers")}
          </Menu.Item>
          <Menu.Item disabled={targets("all").length === 0} onSelect={() => props.onCloseMany(targets("all"))}>
            {language.t("workbench.tabs.closeAll")}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item disabled={targets("left").length === 0} onSelect={() => props.onCloseMany(targets("left"))}>
            {language.t("workbench.tabs.closeLeft")}
          </Menu.Item>
          <Menu.Item disabled={targets("right").length === 0} onSelect={() => props.onCloseMany(targets("right"))}>
            {language.t("workbench.tabs.closeRight")}
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function SortableTrigger(props: {
  value: string
  tab: PanelTab
  index: number
  active: boolean
  preview: boolean
  content: JSX.Element
  close: JSX.Element | undefined
  onClose: (value: string) => void
  onPromote: (value: string) => void
}): JSX.Element {
  const sortable = useSortable({
    get id() {
      return props.value
    },
    get index() {
      return props.index
    },
  })

  return (
    <div ref={sortable.ref} class="h-full flex items-center">
      <div class="relative">
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          aria-controls={props.active ? props.tab.dom?.panel : undefined}
          aria-label={props.tab.missing ? props.tab.title : undefined}
          onMiddleClick={props.tab.closable === false ? undefined : () => props.onClose(props.value)}
          onDblClick={() => {
            if (props.preview) props.onPromote(props.value)
          }}
          closeButton={props.close}
          hideCloseButton
        >
          {props.content}
        </Tabs.Trigger>
      </div>
    </div>
  )
}
