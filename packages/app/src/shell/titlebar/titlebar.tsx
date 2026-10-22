import { createEffect, createMemo, createResource, Show, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"

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
import "./titlebar.css"
import { TitlebarRightMount } from "@/shell/titlebar/right-slot"
import { MobileDrawer, MobileDrawerContent, MobileDrawerLabel, MobileDrawerTrigger } from "@/shell/mobile-drawer"
import { sessionTabTitle } from "./tab-title"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { RecentlyClosedTabsMenu } from "./recently-closed-tabs-menu"
import { rootSession } from "@/shell/routes/session"
import { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "@/runtime/extension/host"
import { useTitlebarItems } from "@/runtime/extension/titlebar-items"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { TitlebarView } from "./titlebar.react"

const titlebarHeight = 36

const windowsTitlebarHeight = 44 // Includes the content inset; matches the native Windows overlay.

const minTitlebarZoom = 0.25

const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

export function Titlebar() {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = createMediaQuery("(max-width: 767px)")
  const bottom = createMemo(() => mobile() && settings.general.mobileTitlebarPosition() === "bottom")
  const mobileTop = createMemo(() => platform.platform === "web" && mobile() && !bottom())

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

  const [history, setHistory] = createStore<{
    stack: HistoryLocation[]
    index: number
    action: "back" | "forward" | undefined
  }>({
    stack: [],
    index: 0,
    action: undefined,
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

  const titlebarItems = useTitlebarItems()

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
          void tabs.newDraft({ server: route.server, directory: pending.draft.directory }, "")

          return
        }

        const activeSession = session()

        if (!activeSession) return

        const sessionTab = {
          type: "session" as const,
          server: route.server,
          sessionId: activeSession.id,
        }

        void tabs.newDraft({ server: sessionTab.server, directory: activeSession.location.directory }, "")

        return
      }

      case "draft": {
        const activeTab = currentTab()

        if (activeTab?.type !== "draft") return

        void tabs.newDraft({ server: activeTab.server, directory: activeTab.directory }, "")

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
      onSelect: (source) => {
        if (source === "keybind" && layout.route().type !== "home") layout.home.searchFocus.request()
        toggleHome()
      },
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

    return sessionTabTitle(value ? value.title : tabs.info[tabKey(tab)]?.title, language.t("session.tab.session"))
  }

  createEffect(() => {
    path()
    mobile()
    setMobileTabs("open", false)
  })

  const host = useExtensionHost()
  const channel = import.meta.env.VITE_OPENCODE_CHANNEL
  const source = sharedSource(() => {
    const debug =
      channel === "dev" || channel === "local"
        ? host.list(TitlebarItem).find((item) => item.placement === "channel")
        : undefined
    return {
      language: sharedLanguage(language),
      mobile: mobile(),
      bottom: bottom(),
      web: platform.platform === "web",
      windows: windows(),
      platformMenu: windows() || linux(),
      mobileTop: mobileTop(),
      macTrafficLights: macTrafficLights(),
      zoom: zoom(),
      minHeight: minHeight(),
      windowsControlsWidth: windowsControlsWidth(),
      showNavigation: settings.general.showNavigation(),
      canBack: !!backPath(history),
      canForward: !!forwardPath(history),
      keybinds: {
        back: command.keybindParts("common.goBack"),
        forward: command.keybindParts("common.goForward"),
      },
      channel: channel && channel !== "prod" ? language.t(`titlebar.channel.${channel}`) : undefined,
      debug: debug ? { ...debug } : undefined,
      items: titlebarItems.ids().flatMap((id) => {
        const item = titlebarItems.item(id)
        return item ? [{ ...item }] : []
      }),
    }
  })
  const slots = {
    platformMenu: sharedMount(() => <WindowsAppMenu command={command} platform={platform} />),
    right: sharedMount(() => <TitlebarRightMount />),
    mobileTabs: sharedMount(() => (
      <MobileDrawer open={mobileTabs.open} onOpenChange={(open) => setMobileTabs("open", open)}>
        <MobileDrawerTrigger
          data-slot="mobile-tabs-trigger"
          class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] leading-4 text-foreground hover:bg-foreground/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [app-region:no-drag]"
          aria-label={language.t("titlebar.tabs")}
        >
          <Show when={currentTab()} fallback={<Icon name="grid-plus" class="shrink-0" />}>
            {(tab) => (
              <span data-slot="project-avatar-slot" class="flex size-4 shrink-0 items-center justify-center">
                <Show
                  when={session()}
                  fallback={
                    tab().type === "draft" ? (
                      <Icon name="edit" />
                    ) : (
                      <Show
                        when={preparing()}
                        fallback={
                          <span class="block size-4 rounded-sm border border-control-edge" aria-hidden="true" />
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
    )),
    desktopTabs: sharedMount(() => (
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
        <RecentlyClosedTabsMenu
          onNewTab={openNewTab}
          tooltip={
            <>
              {language.t("command.session.new")}
              <Keybind keys={command.keybindParts("tab.new")} variant="neutral" />
            </>
          }
        />
      </>
    )),
  }
  return <ReactView component={TitlebarView} props={{ source, slots, back, forward }} />
}
