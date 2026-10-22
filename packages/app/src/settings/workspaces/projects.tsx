import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { addProjects } from "@/home/projects/add"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { settingsProjects } from "../servers/inventory"
import { settingsLanguage } from "../shared.react"
import { createProjectActions } from "./project-actions"
import { Projects } from "./projects.react"

export function createSettingsProjectsServices(props: {
  server: ServerConnection.Any
  active: boolean
  onOpenProject: (project: LocalProject) => void
}) {
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const context = () => global.ensureServerCtx(props.server)
  const actions = createProjectActions(() => props.server)
  const addProject = () =>
    pickDirectory({
      server: props.server,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = homeProjectDirectories(result)
        const directory = addProjects(context(), directories)

        if (!directory) return

        if (directories.length > 1) return

        const project = context()
          .projects.list()
          .find((item) => item.worktree === directory)

        if (!project) return
        props.onOpenProject(project)
      },
    })

  return {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      active: props.active,
      projects: settingsProjects(context()).map((project) => ({
        ...project,
        icon: { ...project.icon },
        unseen: actions.unseen(project),
      })),
      presentation: actions.presentation(),
    })),
    actions,
    addProject,
    openProject: (project: LocalProject) => props.onOpenProject(project),
  }
}
export function SettingsProjects(props: {
  server: ServerConnection.Any
  active: boolean
  onOpenProject: (project: LocalProject) => void
}) {
  const services = createSettingsProjectsServices(props)
  return <ReactView component={Projects} props={{ services }} />
}
