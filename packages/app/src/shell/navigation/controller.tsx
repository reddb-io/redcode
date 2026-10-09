import type { SessionInfo } from "@opencode/client/promise"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, startTransition, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { addProjects } from "@/home/projects/add"
import { useProjectActions } from "@/home/projects/actions"
import { createHomeSessionIndex } from "@/home/sessions/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { isSessionForm } from "@/session/requests/session-request-tree"
import { useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { useCommand } from "@/shell/commands/command"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { useLayout, type LocalProject } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import {
  buildNavigationTree,
  navigationProjectKey,
  navigationSessionOrder,
  nextSessionAwaitingUser,
  sessionStatus,
  type SessionStatus,
  stepNavigation,
} from "./model"

/**
 * The rail and sidemenu's shared state. It lives in the shell, so the tree, the pins and the
 * previous/next commands work while the sidemenu is collapsed to the rail.
 */
export function createNavigationController() {
  const layout = useLayout()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const settings = useSettingsSurface()
  const preferences = useSettings()
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const actions = useProjectActions()
  const mobile = createMediaQuery("(max-width: 767px)")
  const [state, setState] = createStore({
    query: "",
    showAll: {} as Record<string, boolean>,
    since: {} as Record<string, number>,
  })

  const conn = createMemo<ServerConnection.Any | undefined>(
    () =>
      servers.visible.find((item) => ServerConnection.key(item) === layout.home.selection().server) ??
      servers.visible[0],
  )
  const serverKey = () => {
    const current = conn()
    return current ? ServerConnection.key(current) : undefined
  }
  const ctx = useServerCtx(conn)
  const index = createHomeSessionIndex(conn, ctx)
  const pinned = createMemo(() =>
    layout.navigation.pinned
      .list()
      .filter((item) => item.server === serverKey())
      .map((item) => item.session),
  )
  const unread = (sessionID: string) => (ctx()?.notification.session.unseenCount(sessionID) ?? 0) > 0
  // One status per root session. Requests raised by a subagent belong to the root the sidemenu shows.
  const statuses = createMemo(() => {
    const context = ctx()
    if (!context) return new Map<string, SessionStatus>()
    const data = context.data
    const roots = (ids: string[]) => new Set(ids.map((id) => data.session.root(id)))
    const approval = preferences.permissions.autoApprove()
      ? new Set<string>()
      : roots(data.session.permission.sessions())
    const input = roots(
      data.session.form.sessions().filter((id) => data.session.form.list(id)?.some(isSessionForm) ?? false),
    )
    return new Map(
      index.sessions().flatMap((session) => {
        const status = sessionStatus({
          approval: approval.has(session.id),
          input: input.has(session.id),
          working: data.session.status(session.id) === "running",
          // Like the session tab, parked synthetic context is not work waiting to run.
          queued: data.session.pending.list(session.id).some((item) => item.type !== "synthetic"),
          failed: context.notification.session.all(session.id).at(-1)?.type === "error",
          done: unread(session.id),
        })
        return status ? [[session.id, status] as const] : []
      }),
    )
  })
  const status = (sessionID: string) => statuses().get(sessionID)
  // When this client first saw each session running, for the live elapsed time. The server does not
  // publish when an execution started, so one already running when the app loads counts from then.
  createEffect(() => {
    const active = ctx()?.data.session.active() ?? []
    const now = Date.now()
    const since = untrack(() => state.since)
    setState("since", reconcile(Object.fromEntries(active.map((id) => [id, since[id] ?? now]))))
  })
  const tree = createMemo(() =>
    buildNavigationTree({
      projects: ctx()?.projects.list() ?? [],
      sessions: index.sessions(),
      pinned: pinned(),
      query: state.query,
      expanded: layout.navigation.expanded,
      showAll: (key) => !!state.showAll[key],
      status,
    }),
  )

  // The root session the current route shows, when it belongs to the sidemenu's server.
  const currentSession = createMemo(() => {
    const route = layout.route()
    if (route.type !== "session" || route.server !== serverKey()) return
    return ctx()?.data.session.root(route.sessionId) ?? route.sessionId
  })
  const currentProject = createMemo(() => {
    const id = currentSession()
    if (!id) return
    return tree().projects.find(
      (project) =>
        project.sessions.some((item) => item.session.id === id) ||
        (ctx()?.data.session.get(id)?.location.directory ?? "") === project.project.worktree,
    )?.key
  })

  // Running root sessions on every reachable server: the rail's background work badge.
  const background = createMemo(() =>
    servers.visible.flatMap((item) => {
      const key = ServerConnection.key(item)
      if (global.servers.health[key]?.unauthorized) return []
      const data = global.ensureServerCtx(item).data
      return [...new Set(data.session.active().map((id) => data.session.root(id)))].flatMap((id) => {
        const session = data.session.get(id)
        return session ? [{ server: item, session }] : []
      })
    }),
  )

  const closeDrawer = () => {
    if (mobile()) layout.mobileSidebar.hide()
  }

  function openSession(session: SessionInfo, options?: { background?: boolean; server?: ServerConnection.Any }) {
    const target = options?.server ?? conn()
    if (!target) return
    const context = global.ensureServerCtx(target)
    const directory = context.projects.forSession(session)?.worktree ?? session.location.directory
    if (!options?.background) void context.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(target), sessionId: session.id })
      if (!options?.background) tabs.select(tab)
      context.data.session.remember(session)
      context.projects.open(directory)
      if (!options?.background) context.projects.touch(directory)
    })
    if (!options?.background) closeDrawer()
  }

  function toggle() {
    if (mobile()) {
      layout.mobileSidebar.toggle()
      return
    }
    layout.navigation.setOpened(!layout.navigation.opened())
  }

  function stepSession(delta: 1 | -1) {
    const next = stepNavigation(navigationSessionOrder(tree()), currentSession(), delta)
    const session = next ? index.sessions().find((item) => item.id === next) : undefined
    if (session) openSession(session)
  }

  function nextAwaitingUser() {
    const next = nextSessionAwaitingUser(tree(), status, currentSession())
    const session = next ? index.sessions().find((item) => item.id === next) : undefined
    if (session) openSession(session)
  }

  function stepProject(delta: 1 | -1) {
    const projects = tree().projects
    const key = stepNavigation(
      projects.map((project) => project.key),
      currentProject(),
      delta,
    )
    const project = projects.find((item) => item.key === key)
    if (!project) return
    const latest = project.sessions[0]?.session
    if (latest) {
      openSession(latest)
      return
    }
    const server = serverKey()
    if (!server) return
    layout.home.setSelection({ server, directory: project.project.worktree })
    navigate("/")
  }

  command.register("navigation", () => [
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: toggle,
    },
    {
      id: "session.previous",
      title: language.t("command.session.previous"),
      category: language.t("command.category.session"),
      keybind: "alt+arrowup",
      onSelect: () => stepSession(-1),
    },
    {
      id: "session.next",
      title: language.t("command.session.next"),
      category: language.t("command.category.session"),
      keybind: "alt+arrowdown",
      onSelect: () => stepSession(1),
    },
    {
      id: "session.awaiting.next",
      title: language.t("command.session.awaiting.next"),
      category: language.t("command.category.session"),
      keybind: "alt+shift+arrowdown",
      onSelect: nextAwaitingUser,
    },
    {
      id: "project.previous",
      title: language.t("command.project.previous"),
      category: language.t("command.category.project"),
      keybind: "mod+alt+arrowup",
      onSelect: () => stepProject(-1),
    },
    {
      id: "project.next",
      title: language.t("command.project.next"),
      category: language.t("command.category.project"),
      keybind: "mod+alt+arrowdown",
      onSelect: () => stepProject(1),
    },
  ])

  return {
    language,
    mobile,
    server: conn,
    serverKey,
    context: ctx,
    tree,
    loading: index.loading,
    current: { session: currentSession, project: currentProject },
    background,
    panel: {
      opened: () => (mobile() ? layout.mobileSidebar.opened() : layout.navigation.opened()),
      width: layout.navigation.width,
      resize: layout.navigation.resize,
      toggle,
      close: () => (mobile() ? layout.mobileSidebar.hide() : layout.navigation.setOpened(false)),
    },
    filter: {
      value: () => state.query,
      set: (value: string) => setState("query", value),
      clear: () => setState("query", ""),
    },
    section: {
      open: layout.navigation.sectionOpen,
      toggle: layout.navigation.toggleSection,
    },
    project: {
      expanded: (key: string) => tree().projects.find((project) => project.key === key)?.expanded ?? true,
      toggle: (key: string) => layout.navigation.setExpanded(key, !layout.navigation.expanded(key)),
      showAll: (key: string, value: boolean) => setState("showAll", key, value),
      showingAll: (key: string) => !!state.showAll[key],
      newSession: (project: LocalProject) => {
        const current = conn()
        if (!current) return
        actions.newSession(current, project.worktree)
        closeDrawer()
      },
      add: () => {
        const current = conn()
        if (!current) return
        pickDirectory({
          server: current,
          title: language.t("command.project.open"),
          multiple: true,
          onSelect: (result) => addProjects(global.ensureServerCtx(current), homeProjectDirectories(result)),
        })
      },
      unseen: (project: LocalProject) => {
        const current = conn()
        return current ? actions.unseenCount(current, project) : 0
      },
      actions,
    },
    session: {
      open: openSession,
      status,
      /** When this client first saw the session's current execution running. */
      since: (sessionID: string) => state.since[sessionID] as number | undefined,
      unread,
      markRead: (sessionID: string) => ctx()?.notification.session.markViewed(sessionID),
      pinned: (sessionID: string) => {
        const server = serverKey()
        return !!server && layout.navigation.pinned.has(server, sessionID)
      },
      togglePin: (sessionID: string) => {
        const server = serverKey()
        if (server) layout.navigation.pinned.toggle({ server, session: sessionID })
      },
    },
    route: {
      home: () => layout.route().type === "home",
      settings: () => layout.route().type === "settings",
    },
    go: {
      home: () => {
        closeDrawer()
        if (layout.route().type === "home") return
        command.trigger("home.toggle")
      },
      newSession: () => {
        closeDrawer()
        command.trigger("tab.new")
      },
      search: () => command.show(),
      settings: () => {
        closeDrawer()
        settings.open()
      },
      servers: () => settings.open("servers"),
      help: () => platform.openExternal("https://github.com/reddb-io/redcode/issues/new"),
    },
    key: navigationProjectKey,
  }
}

export type NavigationController = ReturnType<typeof createNavigationController>
