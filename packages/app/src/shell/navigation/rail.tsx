import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { sidebarRail } from "@opencode/ui/contracts/sidebar-rail"
import { statusIndicator } from "@opencode/ui/contracts/status-indicator"
import { For, type JSX, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { serverName } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { sessionLabel } from "@/session/title"
import type { NavigationController } from "./controller"
import { Glyph } from "./glyphs"

const rail = sidebarRail()
const running = statusIndicator({ tone: "info", labelled: false })

/**
 * The always-present icon column: destinations and actions, a background work badge, settings and
 * the server at the bottom. One tab stop; the arrow keys move between its controls.
 */
export function NavigationRail(props: { navigation: NavigationController; panelID: string }) {
  const command = useCommand()
  const language = props.navigation.language
  const [state, setState] = createStore({ background: false })
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
          <li>
            <Popover
              open={state.background}
              onOpenChange={(open) => setState("background", open)}
              placement="right-start"
              gutter={8}
            >
              <Tooltip placement="right" value={language.t("navigation.background")} inactive={state.background}>
                <Popover.Trigger
                  as="button"
                  type="button"
                  data-rail-item
                  data-action="navigation-background"
                  tabIndex={-1}
                  class={rail.item({ class: "flex items-center justify-center" })}
                  aria-label={
                    count() > 0
                      ? language.plural("navigation.background.running", count())
                      : language.t("navigation.background")
                  }
                >
                  <Glyph name="activity" />
                  <Show when={count() > 0}>
                    <span
                      aria-hidden="true"
                      class="absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-caption leading-none font-medium tabular-nums text-background"
                    >
                      {count()}
                    </span>
                  </Show>
                </Popover.Trigger>
              </Tooltip>
              <Popover.Portal>
                <Popover.Content
                  data-component="navigation-background-list"
                  aria-label={language.t("navigation.background")}
                  class="z-50 w-72 rounded-lg border border-elevation-overlay-border bg-elevation-overlay-surface p-1 text-foreground shadow-elevation-overlay outline-none"
                >
                  <div class="flex h-7 items-center px-2 text-eyebrow uppercase text-ink-muted">
                    {language.t("navigation.background")}
                  </div>
                  <Show
                    when={count() > 0}
                    fallback={
                      <p class="m-0 px-2 pb-2 pt-1 text-caption text-ink-muted">
                        {language.t("navigation.background.empty")}
                      </p>
                    }
                  >
                    <ul class="m-0 flex list-none flex-col p-0">
                      <For each={props.navigation.background()}>
                        {(item) => (
                          <li>
                            <button
                              type="button"
                              class="flex h-[var(--reddb-spatial-control-height-md)] w-full items-center gap-2 rounded-md px-2 text-start text-body text-foreground hover:bg-foreground/8 active:bg-foreground/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                              onClick={() => {
                                setState("background", false)
                                props.navigation.session.open(item.session, { server: item.server })
                              }}
                            >
                              <span class={running.mark({ class: "motion-safe:animate-pulse" })} aria-hidden="true" />
                              <span dir="auto" class="min-w-0 flex-1 truncate">
                                {sessionLabel(item.session)}
                              </span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Popover.Content>
              </Popover.Portal>
            </Popover>
          </li>
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
