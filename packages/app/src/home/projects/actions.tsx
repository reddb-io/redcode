import { Schema } from "effect"
import type { SessionInfo } from "@opencode/client/promise"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { startTransition } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSshAuthenticate } from "@/servers/ssh/authenticate"
import { useSettingsSurface } from "@/settings/surface"
import { closeHomeProject, errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useLayout, type LocalProject } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useRevealProject } from "./reveal"

/** The project row actions Home and the sidemenu share: one menu, one behavior. */
export function useProjectActions() {
  const platform = usePlatform()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const settings = useSettingsSurface()
  const authenticate = useSshAuthenticate()
  const revealProject = useRevealProject()
  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]

  function newSession(conn: ServerConnection.Any, directory: string) {
    const run = () => {
      const ctx = global.ensureServerCtx(conn)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
      void tabs.newDraft({ server: ServerConnection.key(conn), directory })
    }
    if (authenticate(conn, run)) return
    run()
  }

  function openSession(conn: ServerConnection.Any, directory: string, session: SessionInfo) {
    const ctx = global.ensureServerCtx(conn)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
      ctx.data.session.remember(session)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
    })
  }

  return {
    newSession,
    openSession,
    canImportSession: !!platform.openAttachmentPickerDialog,
    importSession(conn: ServerConnection.Any, project: LocalProject) {
      if (!platform.openAttachmentPickerDialog) return
      void platform
        .openAttachmentPickerDialog(
          {
            title: language.t("command.session.import"),
            accept: ["application/json"],
            extensions: ["json"],
          },
          async (file) => {
            const data = await Schema.decodeUnknownPromise(Schema.fromJsonString(SessionTransfer.Data))(
              await file.text(),
            )
            const api = global.ensureServerCtx(conn).sdk.api.session
            const imported = await api.import({
              ...Schema.encodeSync(SessionTransfer.Data)(data),
              location: { directory: project.worktree },
            } as Parameters<typeof api.import>[0])
            openSession(conn, project.worktree, imported)
          },
        )
        .catch((cause: unknown) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          })
        })
    },
    edit(conn: ServerConnection.Any, project: LocalProject) {
      settings.openProject({ server: ServerConnection.key(conn), project: project.worktree })
    },
    canReveal: revealProject.available,
    reveal: revealProject.reveal,
    unseenCount(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.ensureServerCtx(conn).notification
      return directories(project).reduce((total, directory) => total + notification.project.unseenCount(directory), 0)
    },
    clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
      const notification = global.ensureServerCtx(conn).notification
      directories(project)
        .filter((directory) => notification.project.unseenCount(directory) > 0)
        .forEach((directory) => notification.project.markViewed(directory))
    },
    close(conn: ServerConnection.Any, directory: string) {
      const next = closeHomeProject(
        layout.home.selection(),
        ServerConnection.key(conn),
        global.ensureServerCtx(conn).projects,
        directory,
      )
      if (next) layout.home.setSelection(next)
    },
  }
}

export type ProjectActions = ReturnType<typeof useProjectActions>
