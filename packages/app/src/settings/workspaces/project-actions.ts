import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useRevealProject } from "@/home/projects/reveal"
import { fileManagerApp } from "@/home/projects/file-manager"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ProjectUpdateInput } from "@opencode/client/promise"

export function createProjectActions(server: () => ServerConnection.Any) {
  const global = useGlobal()
  const language = useLanguage()
  const platform = usePlatform()
  const reveal = useRevealProject()
  const context = () => global.ensureServerCtx(server())
  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]
  return {
    presentation: () => ({
      reveal: reveal.available(server()),
      revealLabel: language.t(fileManagerApp(platform.os ?? "unknown").actionLabel),
    }),
    unseen: (project: LocalProject) =>
      directories(project).reduce(
        (total, directory) => total + context().notification.project.unseenCount(directory),
        0,
      ),
    clear: (project: LocalProject) =>
      directories(project)
        .filter((directory) => context().notification.project.unseenCount(directory) > 0)
        .forEach((directory) => context().notification.project.markViewed(directory)),
    close: (project: LocalProject) => context().projects.close(project.worktree),
    reveal: (project: LocalProject) => reveal.reveal(server(), project),
    async persist(project: LocalProject, patch: Pick<ProjectUpdateInput, "name" | "icon" | "commands">) {
      if (project.id && project.id !== "global") {
        const value = await context().sdk.api.project.update({ projectID: project.id, ...patch })
        context().sync.project.update(value)
        return
      }
      context().sync.project.meta(project.worktree, patch)
    },
    notify: (error: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : language.t("common.requestFailed"),
      }),
  }
}
