import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useServerActionsController } from "@/servers/registry/controller"
import { useSettingsCommand } from "@/settings/command"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useDialog } from "@opencode/ui/context/dialog"
import { createResource } from "solid-js"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import type { HomeController } from "../model"
import { useSshAuthenticate } from "@/servers/ssh/authenticate"
import { useProjectActions } from "./actions"

export const HomeServersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const language = useLanguage()
  const openSettings = useSettingsCommand()
  const serverManagement = useServerActionsController()
  const authenticate = useSshAuthenticate()
  const actions = useProjectActions()
  const [_state, setState, _, ready] = persisted(Persist.global("home.servers"), HomeServersSchema, { collapsed: {} })
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )
  function choose(conn: ServerConnection.Any) {
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => home.project.add(conn, homeProjectDirectories(result)),
    })
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canDefault: serverManagement.defaults.available,
      defaultKey: serverManagement.defaults.key,
      setDefault: (conn: ServerConnection.Any | undefined) =>
        serverManagement.defaults.set(conn ? ServerConnection.key(conn) : null),
      canRemove: (conn: ServerConnection.Any) => serverManagement.connection.canRemove(ServerConnection.key(conn)),
      remove: (conn: ServerConnection.Any) => serverManagement.connection.remove(ServerConnection.key(conn)),
      canHide: (conn: ServerConnection.Any) => serverManagement.connection.canHide(ServerConnection.key(conn)),
      hide: (conn: ServerConnection.Any) => serverManagement.connection.setHidden(ServerConnection.key(conn), true),
      edit: (conn: ServerConnection.Http) => {
        void import("@/servers/connect/dialog").then(({ DialogServer }) => {
          void dialog.show(() => <DialogServer mode="edit" server={conn} />)
        })
      },
      authenticate: (conn: ServerConnection.Any) => authenticate(conn),
      focus: (conn: ServerConnection.Any) => {
        if (authenticate(conn, () => home.selection.focusServer(conn))) return
        home.selection.focusServer(conn)
      },
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      homedir: home.project.homedir,
      select: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, () => home.project.select(conn, directory))) return
        home.project.select(conn, directory)
      },
      add: home.project.add,
      openNewSession: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, () => home.project.openProjectNewSession(conn, directory))) return
        home.project.openProjectNewSession(conn, directory)
      },
      canImportSession: actions.canImportSession,
      importSession: actions.importSession,
      edit: actions.edit,
      unseenCount: actions.unseenCount,
      clearNotifications: actions.clearNotifications,
      choose: (conn: ServerConnection.Any) => {
        if (authenticate(conn, () => choose(conn))) return
        if (home.server.health(conn)?.healthy === false) return
        choose(conn)
      },
      close: actions.close,
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        home.server.context(conn).projects.move(worktree, index)
      },
      canReveal: actions.canReveal,
      reveal: actions.reveal,
    },
    utility: {
      settings: openSettings,
      help: () => platform.openExternal("https://github.com/reddb-io/redcode/issues/new"),
    },
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
