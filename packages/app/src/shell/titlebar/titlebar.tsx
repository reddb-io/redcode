import { createEffect, createMemo, createResource, Match, Show, Switch, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"

import { LayoutRoute, useLayout } from "@/shell/state/layout"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { WindowsAppMenu } from "./windows-menu"
import { applyPath, backPath, forwardPath, type HistoryLocation } from "./history"
import { TitlebarTabStrip } from "@/shell/titlebar/tab-strip"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "@/shell/titlebar/session-events"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import type { ComposerState } from "@/composer/persistence"
import "./titlebar.css"
import { newTabTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { TitlebarRightMount } from "@/shell/titlebar/right-slot"
import { MobileDrawer, MobileDrawerContent, MobileDrawerLabel, MobileDrawerTrigger } from "@/shell/mobile-drawer"
import { sessionTabTitle } from "./tab-title"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { updaterAction } from "@/shell/updates/action"
import type { UpdaterState } from "@/shell/updates/types"
import { rootSession } from "@/shell/routes/session"
import devIcon from "./icons/dev.png"
import betaIcon from "./icons/beta.png"

const titlebarHeight = 36
const windowsTitlebarHeight = 44 // Includes the content inset; matches the native Windows overlay.
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.
// Native controls: 14px left inset, two 20px button pitches, and a 14px button.
const macTrafficLightsBaseWidth = 68

export type TitlebarUpdate = {
  state: UpdaterState | undefined
  install: () => void
}

export function Titlebar(props: { update?: TitlebarUpdate; debugTools?: { visible: boolean; toggle: () => void } }) {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = createMediaQuery("(max-width: 767px)")
  const bottom = createMemo(() => mobile() && settings.general.mobileTitlebarPosition() === "bottom")

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const macTrafficLights = createMemo(() => mac() && !platform.windowFullscreen?.())
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`
    if (windows()) return `env(titlebar-area-height, ${windowsTitlebarHeight / Math.min(titlebarZoom(), 1)}px)`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as HistoryLocation[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = { url: path(), state: location.state }

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const updateState = createMemo<TitlebarUpdatePillState>(() => {
    const state = props.update?.state
    const installing = state?.status === "installing"
    const version = state?.status === "ready" || state?.status === "download-required" ? state.version : undefined
    return {
      visible: version !== undefined || installing,
      installing,
      label: language.t("titlebar.update"),
      ariaLabel: language.t(updaterAction(state).label),
      title: version ? language.t("titlebar.updateVersion", { version }) : undefined,
      onInstall: () => props.update?.install(),
    }
  })
  const rightState = createMemo<TitlebarRightState>(() => ({
    update: updateState(),
  }))

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header
      data-slot="titlebar-v2"
      classList={{
        "shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible": true,
        "order-last": bottom(),
      }}
      style={{
        height:
          platform.platform === "web"
            ? bottom()
              ? "calc(28px + max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))"
              : "calc(28px + max(8px, env(safe-area-inset-top, 0px)))"
            : undefined,
        "padding-top": bottom() ? "0px" : "env(safe-area-inset-top, 0px)",
        "padding-bottom": bottom() ? "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" : "0px",
        "min-height": minHeight(),
        // Keep native macOS traffic lights clear even when the desktop window is narrow.
        "padding-left": macTrafficLights() ? `${macTrafficLightsBaseWidth / zoom()}px` : 0,
        width: windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        "max-width": windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        // Native Windows caption controls remain on the physical right in both writing directions.
        "margin-right": windows() ? "auto" : undefined,
      }}
      data-tauri-drag-region
    >
      <Switch>
        <Match when>
          {(_) => {
            const layout = useLayout()
            const global = useGlobal()

            const tabs = useTabs()
            const tabsStore = tabs.store
            const tabsStoreActions = tabs
            const preparing = createMemo(() => {
              const route = layout.route()
              return route.type === "session" && !!tabs.pendingSession(route.server, route.sessionId)
            })
            const [resolvedSession] = createResource(
              () => {
                const route = layout.route()
                if (route.type !== "session") return undefined
                if (preparing()) return undefined
                const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)
                return conn ? { route, ctx: global.ensureServerCtx(conn) } : undefined
              },
              async ({ route, ctx }) => {
                const info = await ctx.sdk.api.session
                  .get({ sessionID: route.sessionId })
                  .catch(() => ctx.data.session.get(route.sessionId))
                if (!info) return
                ctx.data.session.remember(info)
                const rootID = await rootSession(info, async (id) => {
                  const cached = ctx.data.session.get(id)
                  if (cached) return cached
                  const ancestor = await ctx.sdk.api.session.get({ sessionID: id })
                  ctx.data.session.remember(ancestor)
                  return ancestor
                })
                  .then((root) => root.id)
                  .catch(() => ctx.data.session.root(info.id))
                return { info, rootID }
              },
            )
            const session = createMemo(() => {
              const route = layout.route()
              if (route.type !== "session") return
              if (preparing()) return
              const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)
              const cached = conn ? global.ensureServerCtx(conn).data.session.get(route.sessionId) : undefined
              if (cached) return cached
              const resolved = resolvedSession()
              return resolved?.info.id === route.sessionId ? resolved.info : undefined
            })

            const matchRoute = (route: LayoutRoute) => {
              if (route.type === "home") return
              if (route.type === "draft") {
                return tabsStore.find((item) => item.type === "draft" && item.draftID === route.draftID)
              }
              if (route.type === "session") {
                const main = tabsStore.find(
                  (item) =>
                    item.type === "session" &&
                    item.server === route.server &&
                    (item.sessionId === route.sessionId || item.routeSessionId === route.sessionId),
                )
                if (main) return main
                const s = session()
                if (s?.parentID) {
                  const resolved = resolvedSession()
                  const parentID = resolved?.info.id === s.id ? resolved.rootID : s.parentID
                  const parent = tabsStore.find(
                    (item) => item.type === "session" && item.server === route.server && item.sessionId === parentID,
                  )
                  if (parent) return parent
                }
              }
            }

            const currentTab = () => matchRoute(layout.route())

            createEffect(() => {
              const route = layout.route()
              if (!tabs.ready()) return
              const tab = currentTab()
              if (tab) {
                const current = session()
                if (
                  route.type === "session" &&
                  tab.type === "session" &&
                  (route.sessionId === tab.sessionId || current?.id === route.sessionId)
                ) {
                  tabs.rememberSessionRoute(tab, route.sessionId, current?.parentID)
                }
                tabs.remember(tab)
                return
              }

              if (route.type === "session") {
                if (tabs.pendingSession(route.server, route.sessionId)) {
                  tabsStoreActions.addSessionTab({ server: route.server, sessionId: route.sessionId })
                  return
                }
                const s = session()
                if (!s) return
                const resolved = resolvedSession()
                if (s.parentID && resolved?.info.id !== s.id) return
                const sessionId = resolved?.info.id === s.id ? resolved.rootID : s.id
                const next = { server: route.server, sessionId }
                tabsStoreActions.addSessionTab(next)
              }
            })

            makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
              const detail = readSessionTabsRemovedDetail(event)
              if (!detail) return
              tabsStoreActions.removeSessions(detail)
            })

            const openNewTab = () => {
              const route = layout.route()
              switch (route.type) {
                case "session": {
                  const pending = tabs.pendingSession(route.server, route.sessionId)
                  if (pending) {
                    const model = tabs.stateValue<ComposerState>(pending.draft, "prompt")?.model.current()
                    void tabs.newDraft({ server: route.server, directory: pending.draft.directory }, "", model)
                    return
                  }
                  const activeSession = session()
                  if (!activeSession) return

                  const sessionTab = {
                    type: "session" as const,
                    server: route.server,
                    sessionId: activeSession.id,
                  }
                  const model = tabs.stateValue<ComposerState>(sessionTab, "prompt")?.model.current()
                  void tabs.newDraft(
                    { server: sessionTab.server, directory: activeSession.location.directory },
                    "",
                    model,
                  )
                  return
                }
                case "draft": {
                  const activeTab = currentTab()
                  if (activeTab?.type !== "draft") return

                  const model = tabs.stateValue<ComposerState>(activeTab, "prompt")?.model.current()
                  void tabs.newDraft({ server: activeTab.server, directory: activeTab.directory }, "", model)
                  return
                }
                case "settings":
                case "connect":
                case "home": {
                  const selection = layout.home.selection()
                  const conn =
                    global.servers.list().find((item) => ServerConnection.key(item) === selection.server) ??
                    global.servers.list()[0]
                  const projects = conn ? global.ensureServerCtx(conn).projects : undefined
                  const project =
                    projects?.list().find((item) => item.worktree === selection.directory) ??
                    projects?.list().find((item) => item.worktree === projects.last()) ??
                    projects?.list()[0]
                  if (conn && project) {
                    void tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree }, "")
                    return
                  }
                }
              }
            }
            const toggleHome = () => tabs.toggleHome({ home: layout.route().type === "home", current: currentTab() })
            command.register("titlebar-home", () => [
              {
                id: "home.toggle",
                title: language.t("home.title"),
                category: language.t("command.category.view"),
                keybind: windows() ? "alt+home" : "mod+shift+h",
                hidden: true,
                onSelect: toggleHome,
              },
            ])

            command.register("tabs", () => {
              const current = currentTab()

              return [
                {
                  id: "tab.new",
                  category: "tab",
                  title: language.t("command.session.new"),
                  keybind: "mod+t,mod+n",
                  hidden: true,
                  onSelect: openNewTab,
                },
                current && {
                  id: "tab.close",
                  category: "tab",
                  title: language.t("command.tab.close"),
                  keybind: "mod+w",
                  hidden: true,
                  onSelect: () => {
                    tabsStoreActions.closeTab(tabsStore.findIndex((tab) => current === tab))
                  },
                },
                {
                  id: "tab.reopenClosed",
                  category: language.t("command.category.file"),
                  title: language.t("command.tab.reopenClosed"),
                  keybind: "mod+shift+t",
                  onSelect: () => tabsStoreActions.reopenClosedTab(),
                },
              ].filter((v) => v !== undefined)
            })

            const [mobileTabs, setMobileTabs] = createStore({ open: false })
            const currentProject = createMemo(() => {
              const tab = currentTab()
              const value = session()
              if (!tab || !value) return
              const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
              return conn ? global.ensureServerCtx(conn).projects.forSession(value) : undefined
            })
            const currentTitle = () => {
              const tab = currentTab()
              if (!tab) return language.t("home.title")
              if (tab.type === "draft") return language.t("session.tab.session")
              const value = session()
              return sessionTabTitle(
                value ? value.title : tabs.info[tabKey(tab)]?.title,
                language.t("session.tab.session"),
              )
            }
            createEffect(() => {
              path()
              mobile()
              setMobileTabs("open", false)
            })

            return (
              <div
                class="h-full flex-1 overflow-hidden flex flex-row items-center gap-1.5 px-2 md:pe-3"
                classList={{
                  "pt-[max(0px,calc(8px-env(safe-area-inset-top,0px)))]": !bottom() && !windows(),
                  "pb-[max(0px,calc(8px-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))))]": bottom(),
                  "pl-4": macTrafficLights(),
                  // Center the 20px app icon over the sidebar's 16px icon column.
                  "ps-3.5": windows(),
                }}
              >
                <Show when={!mobile()}>
                  <ChannelIndicator debugTools={props.debugTools} />
                </Show>
                <Show when={windows() || linux()}>
                  <WindowsAppMenu command={command} platform={platform} />
                </Show>
                <Show when={!mobile() && settings.general.showNavigation()}>
                  <div data-slot="titlebar-history" class="flex shrink-0 items-center gap-0.5 [app-region:no-drag]">
                    <Tooltip
                      placement="bottom"
                      value={
                        <>
                          {language.t("common.goBack")}
                          <Keybind keys={command.keybindParts("common.goBack")} variant="neutral" />
                        </>
                      }
                    >
                      <IconButton
                        type="button"
                        data-action="titlebar-back"
                        variant="ghost-muted"
                        size="large"
                        icon={<Icon name="arrow-left" />}
                        disabled={!backPath(history)}
                        onClick={back}
                        aria-label={language.t("common.goBack")}
                      />
                    </Tooltip>
                    <Tooltip
                      placement="bottom"
                      value={
                        <>
                          {language.t("common.goForward")}
                          <Keybind keys={command.keybindParts("common.goForward")} variant="neutral" />
                        </>
                      }
                    >
                      <IconButton
                        type="button"
                        data-action="titlebar-forward"
                        variant="ghost-muted"
                        size="large"
                        icon={<Icon name="arrow-right" />}
                        disabled={!forwardPath(history)}
                        onClick={forward}
                        aria-label={language.t("common.goForward")}
                      />
                    </Tooltip>
                  </div>
                </Show>

                <Show
                  when={!mobile()}
                  fallback={
                    <MobileDrawer open={mobileTabs.open} onOpenChange={(open) => setMobileTabs("open", open)}>
                      <MobileDrawerTrigger
                        data-slot="mobile-tabs-trigger"
                        class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] leading-4 text-foreground hover:bg-foreground/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [app-region:no-drag]"
                        aria-label={language.t("titlebar.tabs")}
                      >
                        <Show when={currentTab()} fallback={<Icon name="grid-plus" class="shrink-0" />}>
                          {(tab) => (
                            <span
                              data-slot="project-avatar-slot"
                              class="flex size-4 shrink-0 items-center justify-center"
                            >
                              <Show
                                when={session()}
                                fallback={
                                  tab().type === "draft" ? (
                                    <Icon name="edit" />
                                  ) : (
                                    <Show
                                      when={preparing()}
                                      fallback={
                                        <span
                                          class="block size-4 rounded-sm border border-control-edge"
                                          aria-hidden="true"
                                        />
                                      }
                                    >
                                      <SessionProgressIndicatorV2 />
                                    </Show>
                                  )
                                }
                              >
                                {(value) => (
                                  <SessionTabAvatar
                                    project={currentProject()}
                                    directory={value().location.directory}
                                    sessionId={value().id}
                                    server={tab().server}
                                  />
                                )}
                              </Show>
                            </span>
                          )}
                        </Show>
                        <span data-slot="mobile-tab-title" dir="auto" class="min-w-0 flex-1 truncate text-start">
                          {currentTitle()}
                        </span>
                        <span class="shrink-0 tabular-nums text-ink-muted">{tabsStore.length}</span>
                      </MobileDrawerTrigger>
                      <MobileDrawerContent>
                        <MobileDrawerLabel class="sr-only">{language.t("titlebar.tabs")}</MobileDrawerLabel>
                        <div data-slot="mobile-tabs-drawer" data-corvu-no-drag>
                          <div data-slot="mobile-tabs-drawer-list">
                            <TitlebarTabStrip
                              orientation="vertical"
                              tabs={tabsStore}
                              currentTab={currentTab()}
                              onNavigate={(tab) => {
                                tabs.select(tab)
                                setMobileTabs("open", false)
                              }}
                              onClose={(tab) => {
                                const index = tabsStore.findIndex((item) => tabKey(item) === tabKey(tab))
                                if (index !== -1) tabsStoreActions.closeTab(index)
                              }}
                              onReorder={(keys) => tabsStoreActions.reorder(keys)}
                            />
                          </div>
                          <button
                            type="button"
                            data-action="mobile-tabs-new-session"
                            class="flex h-11 w-full shrink-0 items-center gap-2 rounded-md px-2 text-body text-foreground hover:bg-foreground/8 active:bg-foreground/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                            onClick={() => {
                              openNewTab()
                              setMobileTabs("open", false)
                            }}
                          >
                            <Icon name="plus" />
                            {language.t("command.session.new")}
                          </button>
                        </div>
                      </MobileDrawerContent>
                    </MobileDrawer>
                  }
                >
                  <>
                    <TitlebarTabStrip
                      tabs={tabsStore}
                      currentTab={currentTab()}
                      onNavigate={(tab, el) => {
                        tabs.select(tab)
                        el?.scrollIntoView({ behavior: "instant" })
                      }}
                      onClose={(tab) => {
                        const index = tabsStore.findIndex((item) => tabKey(item) === tabKey(tab))
                        if (index !== -1) tabsStoreActions.closeTab(index)
                      }}
                      onReorder={(keys) => tabsStoreActions.reorder(keys)}
                    />
                    <Tooltip
                      placement="bottom"
                      value={
                        <>
                          {language.t("command.session.new")}
                          <Keybind keys={newTabTooltipKeybind(command)} variant="neutral" />
                        </>
                      }
                    >
                      <IconButton
                        type="button"
                        variant="ghost-muted"
                        size="large"
                        class="shrink-0"
                        icon={<Icon name="plus" />}
                        onClick={openNewTab}
                        aria-label={language.t("command.session.new")}
                      />
                    </Tooltip>
                  </>
                </Show>
                <Show when={!mobile()}>
                  <div class="flex-1" />
                </Show>
                <TitlebarRight state={rightState()} />
              </div>
            )
          }}
        </Match>
      </Switch>
    </header>
  )
}

type TitlebarUpdatePillState = {
  visible: boolean
  installing: boolean
  label: string
  ariaLabel: string
  title?: string
  onInstall: () => void
}

type TitlebarRightState = {
  update: TitlebarUpdatePillState
}

function TitlebarRight(props: { state: TitlebarRightState }) {
  return (
    <div class="relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
      <Show when={props.state.update.visible}>
        <TitlebarUpdateIconButton state={props.state.update} />
      </Show>
      <TitlebarRightMount />
    </div>
  )
}

function TitlebarUpdateIconButton(props: { state: TitlebarUpdatePillState }) {
  return (
    <div
      data-slot="titlebar-update"
      class="group relative me-3 h-5 w-5 shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-out hover:z-30 hover:w-[68px] focus-within:z-30 focus-within:w-[68px] motion-reduce:transition-none"
    >
      <button
        type="button"
        class="absolute end-0 top-0 z-10 flex h-full w-full items-center justify-end overflow-hidden rounded-full border border-feedback-info-border bg-feedback-info-surface text-feedback-info-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 [app-region:no-drag]"
        onClick={props.state.onInstall}
        disabled={props.state.installing}
        aria-busy={props.state.installing}
        aria-label={props.state.ariaLabel}
      >
        <span class="ms-2 me-px shrink-0 translate-x-2 text-[11px] leading-4 font-medium text-foreground opacity-0 motion-safe:transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 motion-reduce:translate-x-0 rtl:-translate-x-2">
          {props.state.label}
        </span>
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Show
            when={!props.state.installing}
            fallback={<span data-slot="titlebar-update-loader" aria-hidden="true" />}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
            </svg>
          </Show>
        </span>
      </button>
    </div>
  )
}

function ChannelIndicator(props: { debugTools?: { visible: boolean; toggle: () => void } }) {
  const language = useLanguage()
  const platform = usePlatform()
  const channel = import.meta.env.VITE_OPENCODE_CHANNEL
  // The production build shows the Brand mark in the same 20px slot the channel badges use.
  if (!channel || channel === "prod")
    return (
      <span
        data-slot="titlebar-mark"
        aria-hidden="true"
        class="me-1.5 flex h-7 w-5 shrink-0 select-none items-center justify-center font-mono text-[13px] font-bold leading-none text-primary"
      >
        ›_
      </span>
    )

  const label = () => language.t(`titlebar.channel.${channel}`)
  const debug = () => (channel === "dev" || channel === "local" ? props.debugTools : undefined)
  return (
    <Tooltip
      placement="bottom"
      value={label()}
      class={`me-1.5 shrink-0 [app-region:no-drag] ${platform.platform === "web" ? "ps-2.5" : ""}`}
    >
      <Dynamic
        component={debug() ? "button" : "div"}
        type={debug() ? "button" : undefined}
        data-slot="channel-indicator"
        class="flex h-7 w-5 shrink-0 items-center justify-center rounded-md [app-region:no-drag]"
        classList={{
          "cursor-pointer hover:bg-foreground/8 active:bg-foreground/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus":
            !!debug(),
        }}
        onClick={() => debug()?.toggle()}
        aria-label={debug() ? language.t("titlebar.toggleDebugTools") : undefined}
        aria-pressed={debug()?.visible}
      >
        <img
          src={channel === "beta" ? betaIcon : devIcon}
          alt={debug() ? "" : label()}
          class="size-5 shrink-0 rounded-sm"
          draggable={false}
        />
      </Dynamic>
    </Tooltip>
  )
}
