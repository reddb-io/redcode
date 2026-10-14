import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { sidebarRail } from "@reddb-io/design-system/contracts/sidebar-rail"
import { type JSX, Show } from "solid-js"
import { serverName } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { useNavigation, type NavigationController } from "./controller"
import { Glyph } from "./glyphs"
import { NAVIGATION_PANEL_ID } from "./model"

const rail = sidebarRail()

/** Compact navigation leaves the conversation full width on phones. */
export function MobileNavigation() {
  const navigation = useNavigation()
  const language = navigation.language
  return (
    <Menu placement="bottom-start" gutter={4}>
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size="large"
        icon={<Icon name="menu" />}
        aria-label={language.t("navigation.label")}
        class="shrink-0 [app-region:no-drag]"
      />
      <Menu.Portal>
        <Menu.Content
          onCloseAutoFocus={(event) => {
            if (!navigation.panel.opened()) return
            event.preventDefault()
            // The menu restores its trigger after this callback; transfer focus afterwards.
            queueMicrotask(() => document.getElementById(NAVIGATION_PANEL_ID)?.focus())
          }}
        >
          <Menu.Item onSelect={navigation.go.home}>{language.t("home.title")}</Menu.Item>
          <Menu.Item onSelect={navigation.go.newSession}>{language.t("command.session.new")}</Menu.Item>
          <Menu.Item onSelect={navigation.go.search}>{language.t("navigation.search")}</Menu.Item>
          <Menu.Item onSelect={navigation.panel.toggle}>{language.t("command.sidebar.toggle")}</Menu.Item>
          <Menu.Item onSelect={navigation.go.agents}>{language.t("agents.title")}</Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={navigation.go.settings}>{language.t("sidebar.settings")}</Menu.Item>
          <Menu.Item onSelect={navigation.go.servers}>{language.t("settings.tab.servers")}</Menu.Item>
          <Menu.Item onSelect={navigation.go.help}>{language.t("navigation.help")}</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

/**
 * The always-present icon column: destinations and actions, a background work badge, settings and
 * the server at the bottom. One tab stop; the arrow keys move between its controls.
 */
export function NavigationRail(props: { navigation: NavigationController; panelID: string }) {
  const command = useCommand()
  const language = props.navigation.language

  const count = () => props.navigation.background().length
  const avatar = () => {
    const name = serverName(props.navigation.server())
    return Array.from(name.replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?"
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, (index: number, count: number) => number> = {
      ArrowDown: (index, count) => (index + 1) % count,
      ArrowUp: (index, count) => (index - 1 + count) % count,
      Home: () => 0,
      End: (_, count) => count - 1,
    }
    const move = keys[event.key]
    if (!move || !(event.target instanceof HTMLElement)) return
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-rail-item]")]
    const index = items.indexOf(event.target)
    if (index === -1) return
    event.preventDefault()
    items.forEach((item) => (item.tabIndex = -1))
    const next = items[move(index, items.length)]
    if (!next) return
    next.tabIndex = 0
    next.focus()
  }

  return (
    <nav
      data-component="navigation-rail"
      aria-label={language.t("navigation.label")}
      class={rail.root()}
      onKeyDown={onKeyDown}
    >
      <div class={rail.region({ class: rail.middle({ class: "overflow-x-hidden" }) })}>
        <ul class={rail.list()}>
          <RailItem
            label={language.t("home.title")}
            keybind={command.keybindParts("home.toggle")}
            current={props.navigation.route.home()}
            first
            onClick={props.navigation.go.home}
          >
            <Glyph name="home" />
          </RailItem>
          <RailItem
            label={language.t("command.session.new")}
            keybind={command.keybindParts("tab.new")}
            onClick={props.navigation.go.newSession}
          >
            <Icon name="new-session" />
          </RailItem>
          <RailItem
            label={language.t("navigation.search")}
            keybind={command.keybindParts("command.palette")}
            onClick={props.navigation.go.search}
          >
            <Icon name="magnifying-glass" />
          </RailItem>
          <RailItem
            label={language.t("command.sidebar.toggle")}
            keybind={command.keybindParts("sidebar.toggle")}
            expanded={props.navigation.panel.opened()}
            controls={props.panelID}
            onClick={props.navigation.panel.toggle}
          >
            <Icon name={props.navigation.panel.opened() ? "layout-left-full" : "layout-left"} />
          </RailItem>
          <RailItem
            label={language.t("agents.title")}
            current={props.navigation.route.agents()}
            keybind={command.keybindParts("agents.open")}
            onClick={props.navigation.go.agents}
          >
            <Glyph name="activity" />
            <Show when={count() > 0}>
              <span
                class="absolute end-0.5 top-0.5 rounded-full bg-foreground px-1 text-caption text-background"
                aria-hidden="true"
              >
                {count()}
              </span>
            </Show>
          </RailItem>
        </ul>
      </div>
      <div class={rail.region()}>
        <ul class={rail.list()}>
          <RailItem
            label={language.t("sidebar.settings")}
            keybind={command.keybindParts("settings.open")}
            current={props.navigation.route.settings()}
            onClick={props.navigation.go.settings}
          >
            <Icon name="settings-gear" />
          </RailItem>
          <RailItem label={language.t("navigation.help")} onClick={props.navigation.go.help}>
            <Icon name="help" />
          </RailItem>
          <RailItem label={serverName(props.navigation.server())} onClick={props.navigation.go.servers}>
            <span
              class="flex size-6 items-center justify-center rounded-full border border-control-edge bg-muted text-caption font-medium text-foreground"
              aria-hidden="true"
            >
              {avatar()}
            </span>
          </RailItem>
        </ul>
      </div>
    </nav>
  )
}

function RailItem(props: {
  label: string
  keybind?: string[]
  current?: boolean
  expanded?: boolean
  controls?: string
  first?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <li>
      <Tooltip
        placement="right"
        value={
          <>
            {props.label}
            <Show when={props.keybind?.length}>
              <Keybind keys={props.keybind ?? []} variant="neutral" />
            </Show>
          </>
        }
      >
        <button
          type="button"
          data-rail-item
          tabIndex={props.first ? 0 : -1}
          class={rail.item({ class: "flex items-center justify-center" })}
          aria-label={props.label}
          aria-pressed={props.current === undefined ? undefined : props.current}
          aria-expanded={props.expanded}
          aria-controls={props.controls}
          onClick={() => props.onClick()}
        >
          {props.children}
        </button>
      </Tooltip>
    </li>
  )
}
