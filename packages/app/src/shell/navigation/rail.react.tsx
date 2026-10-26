/** @jsxImportSource react */
import type { KeyboardEvent, ReactNode } from "react"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { sidebarRail, bottomNavigation, navItem } from "@reddb-io/design-system/app/recipes"
import { indicator, badge } from "@reddb-io/design-system/base/recipes"
import { Icon } from "@/runtime/react/icon.react"
import type { NavigationController } from "./controller"
import type { NavigationView } from "./view"
import { Glyph } from "./glyph.react"
import { NAVIGATION_PANEL_ID, NAVIGATION_BROWSE_ID } from "./model"

const notification = indicator()
const dock = bottomNavigation()

type NavigationProps = { view: NavigationView; navigation: NavigationController }

/** The dock reserves its height in shell flow; the last bottom bar owns safe-area padding. */
export function MobileNavigationDock(props: NavigationProps & { safeArea: boolean }) {
  const { view, navigation } = props
  const language = view.language
  const browse = () => {
    navigation.panel.toggle()
    if (!view.opened) queueMicrotask(() => document.getElementById(NAVIGATION_PANEL_ID)?.focus())
  }
  return (
    <nav
      aria-label={language.t("navigation.mobile")}
      className={dock.root({ class: "shrink-0" })}
      style={{
        paddingBottom: props.safeArea ? "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" : "0px",
      }}
    >
      <ul className={dock.list()}>
        <DockItem label={language.t("home.title")} current={view.route.home} onClick={navigation.go.home}>
          <Glyph name="home" />
        </DockItem>
        <DockItem
          id={NAVIGATION_BROWSE_ID}
          label={language.t("navigation.browse")}
          expanded={view.opened}
          controls={NAVIGATION_PANEL_ID}
          current={!view.route.home && !view.route.agents && !view.route.settings}
          onClick={browse}
        >
          <Icon name="layout-left" />
        </DockItem>
        <DockItem
          label={language.t("agents.title")}
          current={view.route.agents}
          onClick={navigation.go.agents}
          description={view.count > 0 ? language.plural("navigation.background.running", view.count) : undefined}
        >
          <span className={notification.root({ class: "size-full items-center justify-center" })}>
            <Glyph name="activity" />
            {view.count > 0 && (
              <span data-indicator-marker className={notification.marker()} aria-hidden="true">
                <span className={badge({ variant: "filled", class: dock.badge() })}>
                  {view.count > 99 ? "99+" : view.count}
                </span>
              </span>
            )}
          </span>
        </DockItem>
        <DockItem label={language.t("navigation.search")} onClick={navigation.go.search}>
          <Icon name="magnifying-glass" />
        </DockItem>
        <li
          aria-current={view.route.settings ? "page" : undefined}
          className={dock.entry({
            class: navItem({ current: view.route.settings }).root({
              class: dock.item({ class: "navigation-more min-h-[44px]" }),
            }),
          })}
        >
          <DropdownMenu
            triggerLabel={language.t("navigation.more")}
            contentLabel={language.t("navigation.more")}
            variant="ghost"
            side="top"
            align="end"
            trigger={
              <>
                <span className={dock.face()}>
                  <Icon name="menu" />
                </span>
                <span className="max-w-full break-words">{language.t("navigation.more")}</span>
              </>
            }
            items={[
              { items: [{ id: "new", label: language.t("command.session.new"), onselect: navigation.go.newSession }] },
              {
                items: [
                  { id: "settings", label: language.t("sidebar.settings"), onselect: navigation.go.settings },
                  { id: "servers", label: language.t("settings.tab.servers"), onselect: navigation.go.servers },
                  { id: "help", label: language.t("navigation.help"), onselect: navigation.go.help },
                ],
              },
            ]}
          />
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
  children: ReactNode
}) {
  return (
    <li className={dock.entry()}>
      <button
        id={props.id}
        type="button"
        aria-label={props.label}
        aria-description={props.description}
        aria-pressed={props.current}
        aria-expanded={props.expanded}
        aria-controls={props.controls}
        className={navItem({ current: props.current }).root({ class: dock.item({ class: "flex min-h-[44px]" }) })}
        onClick={props.onClick}
      >
        <span className={dock.face()}>{props.children}</span>
        <span className="max-w-full break-words">{props.label}</span>
      </button>
    </li>
  )
}

/** One rail tab stop; arrows move between destinations and actions. */
export function NavigationRail(props: NavigationProps) {
  const { view, navigation } = props
  const language = view.language
  const rail = sidebarRail({ labelled: true })
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const keys: Record<string, (index: number, count: number) => number> = {
      ArrowDown: (index, count) => (index + 1) % count,
      ArrowUp: (index, count) => (index - 1 + count) % count,
      Home: () => 0,
      End: (_, count) => count - 1,
    }
    const move = keys[event.key]
    if (!move || !(event.target instanceof HTMLElement)) return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-item]")]
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
      className={rail.root({
        class:
          "w-[calc(max(5.75em,var(--reddb-spatial-control-height-md)*1.5)+var(--reddb-spatial-inset-sm))] min-w-[calc(var(--reddb-spatial-control-height-md)+var(--reddb-spatial-inset-sm)/2+1px)] p-[calc(var(--reddb-spatial-inset-sm)/4)]",
      })}
      onKeyDown={onKeyDown}
    >
      <div className={rail.region({ class: rail.middle({ class: "overflow-x-hidden" }) })}>
        <ul className={rail.list()} style={{ gap: view.gap }}>
          <RailItem
            label={language.t("home.title")}
            keybind={view.keybinds["home.toggle"]}
            current={view.route.home}
            first
            onClick={navigation.go.home}
          >
            <Glyph name="home" />
          </RailItem>
          <RailItem
            label={language.t("command.session.new")}
            keybind={view.keybinds["tab.new"]}
            onClick={navigation.go.newSession}
          >
            <Icon name="new-session" />
          </RailItem>
          <RailItem
            label={language.t("navigation.search")}
            keybind={view.keybinds["command.palette"]}
            onClick={navigation.go.search}
          >
            <Icon name="magnifying-glass" />
          </RailItem>
          <RailItem
            label={language.t("command.sidebar.toggle")}
            keybind={view.keybinds["sidebar.toggle"]}
            expanded={view.opened}
            controls={NAVIGATION_PANEL_ID}
            onClick={navigation.panel.toggle}
          >
            <Icon name={view.opened ? "layout-left-full" : "layout-left"} />
          </RailItem>
          <RailItem
            label={language.t("agents.title")}
            description={view.count > 0 ? language.plural("navigation.background.running", view.count) : undefined}
            current={view.route.agents}
            keybind={view.keybinds["agents.open"]}
            onClick={navigation.go.agents}
          >
            <span className={notification.root({ class: rail.badgeAnchor() })}>
              <Glyph name="activity" />
              {view.count > 0 && (
                <span data-indicator-marker className={notification.marker()} aria-hidden="true">
                  <span className={badge({ variant: "filled", class: rail.badge() })}>
                    {view.count > 99 ? "99+" : view.count}
                  </span>
                </span>
              )}
            </span>
          </RailItem>
        </ul>
      </div>
      <div className={rail.region()}>
        <ul className={rail.list()} style={{ gap: view.gap }}>
          <RailItem
            label={language.t("sidebar.settings")}
            keybind={view.keybinds["settings.open"]}
            current={view.route.settings}
            onClick={navigation.go.settings}
          >
            <Icon name="settings-gear" />
          </RailItem>
          <RailItem label={language.t("navigation.help")} onClick={navigation.go.help}>
            <Icon name="help" />
          </RailItem>
          <RailItem
            label={language.t("navigation.server")}
            tooltip={view.serverName}
            description={view.serverName}
            onClick={navigation.go.servers}
          >
            <Icon name="server" />
          </RailItem>
        </ul>
      </div>
    </nav>
  )
}

function RailItem(props: {
  label: string
  description?: string
  tooltip?: string
  keybind?: string[]
  current?: boolean
  expanded?: boolean
  controls?: string
  first?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const rail = sidebarRail({ labelled: true })
  return (
    <li className="w-full">
      <Tooltip
        label={props.label}
        content={[props.tooltip ?? props.label, ...(props.keybind ?? [])].join(" ")}
        child={({ props: trigger }) => (
          <button
            {...trigger}
            type="button"
            data-rail-item
            tabIndex={props.first ? 0 : -1}
            className={rail.item({
              class:
                "flex items-center justify-center gap-[calc(var(--reddb-spatial-gap-sm)/2)] py-[calc(var(--reddb-spatial-gap-sm)/2)]",
            })}
            aria-label={props.label}
            aria-description={props.description}
            aria-pressed={props.current}
            aria-expanded={props.expanded}
            aria-controls={props.controls}
            onClick={props.onClick}
          >
            <span
              className={rail.face({
                class: "size-[18px] [&_svg]:size-[18px]",
              })}
            >
              {props.children}
            </span>
            <span className={rail.label({ class: "text-[11px] leading-[var(--line-height-compact)]" })}>
              {props.label}
            </span>
          </button>
        )}
      />
    </li>
  )
}
