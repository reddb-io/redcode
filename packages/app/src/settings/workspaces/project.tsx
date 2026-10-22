import { useLanguage } from "@/runtime/i18n/language"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { useSettingsServers } from "../servers/inventory"
import { settingsLanguage } from "../shared.react"
import { createProjectActions } from "./project-actions"
import { ProjectGeneral } from "./project.react"

export function createProjectGeneralServices(props: {
  project: LocalProject
  server: ServerConnection.Any
  onOpenServer: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const servers = useSettingsServers()
  const actions = createProjectActions(() => props.server)
  return {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      project: { ...props.project, icon: { ...props.project.icon }, commands: { ...props.project.commands } },
      serverName: serverName(props.server) || ServerConnection.key(props.server),
      serverKey: ServerConnection.key(props.server),
      multiple: servers().length > 1,
      presentation: actions.presentation(),
      unseen: actions.unseen(props.project),
    })),
    actions,
    onOpenServer: () => props.onOpenServer(),
    onClose: () => props.onClose(),
  }
}
export function SettingsProjectGeneral(props: {
  project: LocalProject
  server: ServerConnection.Any
  onOpenServer: () => void
  onClose: () => void
}) {
  const services = createProjectGeneralServices(props)
  return <ReactView component={ProjectGeneral} props={{ services }} />
}
