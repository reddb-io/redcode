import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { sidebarRail } from "@reddb-io/design-system/contracts/sidebar-rail"
import { bottomNavigation } from "@reddb-io/design-system/contracts/bottom-navigation"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { indicator } from "@reddb-io/design-system/contracts/indicator"
import { badge } from "@reddb-io/design-system/contracts/badge"
import { createMemo, type JSX, Show } from "solid-js"
import { useSettings } from "@/settings/model"
import { serverName } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { useNavigation, type NavigationController } from "./controller"
import { Glyph } from "./glyphs"
import { NAVIGATION_PANEL_ID, NAVIGATION_BROWSE_ID } from "./model"

const notification = indicator()
const dock = bottomNavigation()

/** The dock reserves its height in shell flow; the last bottom bar owns safe-area padding. */
export function MobileNavigationDock(props: { safeArea: boolean }) {
  const navigation = useNavigation()
  const language = navigation.language
  const count = () => navigation.background().length
  const browse = () => {
    navigation.panel.toggle()
    if (navigation.panel.opened()) queueMicrotask(() => document.getElementById(NAVIGATION_PANEL_ID)?.focus())
  }
  return (
    <nav
      aria-label={language.t("navigation.mobile")}
      class={dock.root({ class: "shrink-0" })}
      style={{
        "padding-bottom": props.safeArea ? "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" : "0px",
      }}
    >
      <ul class={dock.list()}>
        <DockItem label={language.t("home.title")} current={navigation.route.home()} onClick={navigation.go.home}>
          <Glyph name="home" />
        </DockItem>
        <DockItem
          id={NAVIGATION_BROWSE_ID}
          label={language.t("navigation.browse")}
          expanded={navigation.panel.opened()}
          controls={NAVIGATION_PANEL_ID}
          current={!navigation.route.home() && !navigation.route.agents() && !navigation.route.settings()}
          onClick={browse}
        >
          <Icon name="layout-left" />
        </DockItem>
        <DockItem
          label={language.t("agents.title")}
          current={navigation.route.agents()}
          onClick={navigation.go.agents}
          description={count() > 0 ? language.plural("navigation.background.running", count()) : undefined}
        >
          <span class={notification.root({ class: "size-full items-center justify-center" })}>
            <Glyph name="activity" />
            <Show when={count() > 0}>
              <span data-indicator-marker class={notification.marker()} aria-hidden="true">
                <span class={badge({ variant: "filled", class: dock.badge() })}>{count() > 99 ? "99+" : count()}</span>
              </span>
            </Show>
          </span>
        </DockItem>
        <DockItem label={language.t("navigation.search")} onClick={navigation.go.search}>
          <Icon name="magnifying-glass" />
        </DockItem>
        <li class={dock.entry()}>
          <Menu placement="top-end" gutter={4}>
            <Menu.Trigger
              class={navItem({ current: navigation.route.settings() }).root({
                class: dock.item({ class: "flex w-full min-h-[44px]" }),
              })}
              aria-label={language.t("navigation.more")}
              aria-pressed={navigation.route.settings()}
            >
              <span class={dock.face()}>
                <Icon name="menu" />
              </span>
              <span class="max-w-full break-words">{language.t("navigation.more")}</span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item onSelect={navigation.go.newSession}>{language.t("command.session.new")}</Menu.Item>
                <Menu.Separator />
                <Menu.Item onSelect={navigation.go.settings}>{language.t("sidebar.settings")}</Menu.Item>
                <Menu.Item onSelect={navigation.go.servers}>{language.t("settings.tab.servers")}</Menu.Item>
                <Menu.Item onSelect={navigation.go.help}>{language.t("navigation.help")}</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </li>
      </ul>
    </nav>
  )
}

function DockItem(props: {
  id?: string
  label: string
  description?: string
  current?: boolean
  expanded?: boolean
  controls?: string
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <li class={dock.entry()}>
      <button
        id={props.id}
        type="button"
        aria-label={props.label}
        aria-description={props.description}
        aria-pressed={props.current}
        aria-expanded={props.expanded}
        aria-controls={props.controls}
        class={navItem({ current: props.current }).root({ class: dock.item({ class: "flex min-h-[44px]" }) })}
        onClick={props.onClick}
      >
        <span class={dock.face()}>{props.children}</span>
        <span class="max-w-full break-words">{props.label}</span>
      </button>
    </li>
  )
}

/**
 * The always-present icon column: destinations and actions, a background work badge, settings and
 * the server at the bottom. One tab stop; the arrow keys move between its controls.
 */
export function NavigationRail(props: { navigation: NavigationController; panelID: string }) {
  const command = useCommand()
  const language = props.navigation.language
  const settings = useSettings()
  const labelled = settings.general.navigationLabels
  const rail = createMemo(() => sidebarRail({ labelled: labelled() }))

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
      class={rail().root()}
      onKeyDown={onKeyDown}
    >
      <div class={rail().region({ class: rail().middle({ class: "overflow-x-hidden" }) })}>
        <ul class={rail().list()}>
          <RailItem
            labelled={labelled()}
            label={language.t("home.title")}
            keybind={command.keybindParts("home.toggle")}
            current={props.navigation.route.home()}
            first
            onClick={props.navigation.go.home}
          >
            <Glyph name="home" />
          </RailItem>
          <RailItem
            labelled={labelled()}
            label={language.t("command.session.new")}
            keybind={command.keybindParts("tab.new")}
            onClick={props.navigation.go.newSession}
          >
            <Icon name="new-session" />
          </RailItem>
          <RailItem
            labelled={labelled()}
            label={language.t("navigation.search")}
            keybind={command.keybindParts("command.palette")}
            onClick={props.navigation.go.search}
          >
            <Icon name="magnifying-glass" />
          </RailItem>
          <RailItem
            labelled={labelled()}
            label={language.t("command.sidebar.toggle")}
            keybind={command.keybindParts("sidebar.toggle")}
            expanded={props.navigation.panel.opened()}
            controls={props.panelID}
            onClick={props.navigation.panel.toggle}
          >
            <Icon name={props.navigation.panel.opened() ? "layout-left-full" : "layout-left"} />
          </RailItem>
          <RailItem
            labelled={labelled()}
            label={language.t("agents.title")}
            description={count() > 0 ? language.plural("navigation.background.running", count()) : undefined}
            current={props.navigation.route.agents()}
            keybind={command.keybindParts("agents.open")}
            onClick={props.navigation.go.agents}
          >
            <span class={rail().face()}>
              <span class={notification.root({ class: rail().badgeAnchor() })}>
                <Glyph name="activity" />
                <Show when={count() > 0}>
                  <span data-indicator-marker class={notification.marker()} aria-hidden="true">
                    <span class={badge({ variant: "filled", class: rail().badge() })}>
                      {count() > 99 ? "99+" : count()}
                    </span>
                  </span>
                </Show>
              </span>
            </span>
          </RailItem>
        </ul>
      </div>
      <div class={rail().region()}>
        <ul class={rail().list()}>
          <RailItem
            labelled={labelled()}
            label={language.t("sidebar.settings")}
            keybind={command.keybindParts("settings.open")}
            current={props.navigation.route.settings()}
            onClick={props.navigation.go.settings}
          >
            <Icon name="settings-gear" />
          </RailItem>
          <RailItem labelled={labelled()} label={language.t("navigation.help")} onClick={props.navigation.go.help}>
            <Icon name="help" />
          </RailItem>
          <RailItem
            labelled={labelled()}
            label={serverName(props.navigation.server())}
            onClick={props.navigation.go.servers}
          >
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
  labelled: boolean
  label: string
  description?: string
  keybind?: string[]
  current?: boolean
  expanded?: boolean
  controls?: string
  first?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  const rail = createMemo(() => sidebarRail({ labelled: props.labelled }))
  return (
    <li class={props.labelled ? "w-full" : undefined}>
      <Tooltip
        class={props.labelled ? "w-full" : undefined}
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
          class={rail().item({ class: "flex items-center justify-center" })}
          aria-label={props.label}
          aria-description={props.description}
          aria-pressed={props.current === undefined ? undefined : props.current}
          aria-expanded={props.expanded}
          aria-controls={props.controls}
          onClick={() => props.onClick()}
        >
          <span class={rail().face()}>{props.children}</span>
          <Show when={props.labelled}>
            <span class={rail().label()}>{props.label}</span>
          </Show>
        </button>
      </Tooltip>
    </li>
  )
}
