import type { HomeProjectSelection, LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar-data"
import { ServerConnection } from "@/runtime/server/registry"
import type { useLanguage } from "@/runtime/i18n/language"
import type { ServerHealth } from "@/runtime/server/health"
import { usePlatform } from "@/runtime/platform/platform"
import { useProjectMenuItems } from "@/runtime/extension/projects"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { fileManagerApp } from "./file-manager"
import { HomeProjectsNativeView } from "./view.react"
import "./view.css"

export type HomeProjectsViewProps = {
  dropdown?: boolean
  language: ReturnType<typeof useLanguage>
  servers: ServerConnection.Any[]
  projects: LocalProject[]
  recentlyClosed: LocalProject[]
  selection: HomeProjectSelection
  homedir: string
  serverHealth: (server: ServerConnection.Any) => ServerHealth | undefined
  projectsForServer: (server: ServerConnection.Any) => LocalProject[]
  collapsed: (server: ServerConnection.Any) => boolean
  canRevealProject: (server: ServerConnection.Any) => boolean
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  onChooseProject: (server: ServerConnection.Any) => void
  onFocusServer: (server: ServerConnection.Any) => void
  onAuthenticateServer?: (server: ServerConnection.Any) => void
  onToggleCollapsed: (server: ServerConnection.Any) => void
  onEditServer: (server: ServerConnection.Http) => void
  canRemoveServer: (server: ServerConnection.Any) => boolean
  onRemoveServer: (server: ServerConnection.Any) => void
  canHideServer: (server: ServerConnection.Any) => boolean
  onHideServer: (server: ServerConnection.Any) => void
  onMoveProject: (server: ServerConnection.Any, worktree: string, index: number) => void
  onSelectProject: (server: ServerConnection.Any, directory: string) => void
  onAddProjects: (server: ServerConnection.Any, directories: string[]) => void
  onOpenProjectNewSession: (server: ServerConnection.Any, directory: string) => void
  canImportSession: boolean
  onImportSession: (server: ServerConnection.Any, project: LocalProject) => void
  onEditProject: (server: ServerConnection.Any, project: LocalProject) => void
  onRevealProject: (server: ServerConnection.Any, project: LocalProject) => void
  onClearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  onCloseProject: (server: ServerConnection.Any, directory: string) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

export function createHomeProjectsViewServices(props: HomeProjectsViewProps) {
  const platform = usePlatform()
  const extensions = useProjectMenuItems()
  const project = (server: ServerConnection.Any, item: LocalProject) => ({
    project: { ...item, icon: item.icon ? { ...item.icon } : undefined },
    name: displayName(item),
    unseen: props.unseenCount(server, item),
  })
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(props.language),
      dropdown: props.dropdown ?? false,
      selection: { ...props.selection },
      homedir: props.homedir,
      canImport: props.canImportSession,
      revealLabel: props.language.t(
        fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown").actionLabel,
      ),
      extensions: extensions().map((item) => ({ id: item.id, title: item.title, run: item.run })),
      servers: props.servers.map((server) => {
        const health = props.serverHealth(server)
        return {
          server: { ...server, http: { ...server.http } },
          key: ServerConnection.key(server),
          name: server.displayName ?? new URL(server.http.url).host,
          health: health ? { ...health } : undefined,
          authentication:
            (server.type === "extension" && !!server.authenticationRequired) ||
            (server.type === "http" && !!health?.unauthorized),
          connecting: server.type === "extension" && !!server.connecting,
          collapsed: props.collapsed(server),
          canRemove: props.canRemoveServer(server),
          canHide: props.canHideServer(server),
          canEdit: !ServerConnection.builtin(server) && server.type === "http",
          canReveal: props.canRevealProject(server),
          projects: (props.servers.length === 1 ? props.projects : props.projectsForServer(server)).map((item) =>
            project(server, item),
          ),
          recentlyClosed: props.recentlyClosed.map((item) => project(server, item)),
        }
      }),
    })),
    choose: props.onChooseProject,
    focus: props.onFocusServer,
    authenticate: (server: ServerConnection.Any) => props.onAuthenticateServer?.(server),
    collapse: props.onToggleCollapsed,
    editServer: props.onEditServer,
    removeServer: props.onRemoveServer,
    hideServer: props.onHideServer,
    move: props.onMoveProject,
    select: props.onSelectProject,
    add: props.onAddProjects,
    newSession: props.onOpenProjectNewSession,
    import: props.onImportSession,
    edit: props.onEditProject,
    reveal: props.onRevealProject,
    clear: props.onClearNotifications,
    close: props.onCloseProject,
    settings: props.onOpenSettings,
    help: props.onOpenHelp,
  }
}

export function HomeProjectsView(props: HomeProjectsViewProps) {
  const services = createHomeProjectsViewServices(props)
  return <ReactView component={HomeProjectsNativeView} props={{ services }} />
}
