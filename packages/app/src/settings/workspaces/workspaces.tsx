import { createMemo } from "solid-js"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { containsDirectory } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import { useHostApis } from "@/runtime/extension/root"
import { ServerConnection } from "@/runtime/server/registry"
import type { Project } from "@/runtime/server/types"
import { worktreeInventoryKey } from "@/workspaces/inventory"
import {
  inspectWorkspaceDeletion,
  mergeWorkspaceSessionInventory,
  workspaceInventory,
  type WorkspaceDeleteInspection,
} from "@/workspaces/paths"
import { listAllSessions } from "@/session/list"
import { pathKey } from "@/workspaces/path-key"
import { showToast } from "@/shell/notifications/toast"
import { ReactView } from "@/runtime/react/view"
import { sharedSource, type SharedSource } from "@/runtime/react/source"
import { settingsLanguage, type SettingsLanguage } from "../shared.react"
import { workspaceInventoryQuery } from "./queries"
import { Workspaces } from "./workspaces.react"

export type Workspace = { directory: string; project: Project }
export type WorkspaceContext = {
  inspect: (workspace: Workspace) => Promise<{ result: WorkspaceDeleteInspection; sessions: SessionInfo[] }>
  remove: (workspace: Workspace, force: boolean) => Promise<void>
  complete: (workspace: Workspace) => Promise<void>
}
export type WorkspacesServices = {
  snapshot: SharedSource<{
    language: SettingsLanguage
    inventory: Project[]
    sessions: SessionInfo[]
    projectID?: string
    reset: number
    pending: boolean
    error: boolean
    sessionPending: boolean
    sessionError: boolean
    sessionPlaceholder: boolean
  }>
  capture: () => WorkspaceContext
  notify: (toast: Parameters<typeof showToast>[0]) => void
}
export function createWorkspacesServices(props: {
  activeDirectory?: string
  resetProjectFilter?: () => number
  projectID?: string
}): WorkspacesServices {
  const language = useLanguage()
  const server = useServer()
  const sdk = server.ctx.sdk
  const client = useQueryClient()
  const data = server.ctx.data
  const tabs = useTabs()
  const extensions = useHostApis()
  const projects = useQuery(() => ({
    ...workspaceInventoryQuery(server.ctx, client, props.projectID),
    enabled: sdk.connection.status() === "connected",
    refetchOnMount: true,
  }))
  const inventory = createMemo(() => (projects.isPending ? [] : (projects.data ?? [])))
  const workspaces = createMemo(() => workspaceInventory(inventory()))
  const loadSessions = async (directories: readonly string[]) =>
    mergeWorkspaceSessionInventory(
      (
        await Promise.all(
          directories.map((directory) => listAllSessions(sdk.api.session, { order: "desc", directory })),
        )
      ).flat(),
      data.session.list(),
    )
  const sessions = useQuery(() => ({
    queryKey: [
      sdk.scope,
      null,
      "settings-workspace-sessions",
      workspaces().map((item) => String(pathKey(item.directory))),
    ],
    queryFn: () => loadSessions(workspaces().map((item) => item.directory)),
    enabled: sdk.connection.status() === "connected" && workspaces().length > 0,
    placeholderData: (previous) => previous,
    refetchOnMount: "always",
  }))
  return {
    snapshot: sharedSource(() => ({
      language: settingsLanguage(language),
      inventory: inventory(),
      sessions: mergeWorkspaceSessionInventory(sessions.isPending ? [] : (sessions.data ?? []), data.session.list())
        .filter((session) =>
          workspaces().some((workspace) => containsDirectory(workspace.directory, session.location.directory)),
        )
        .map((session) => ({ ...session, time: { ...session.time } })),
      projectID: props.projectID,
      reset: props.resetProjectFilter?.() ?? 0,
      pending: projects.isPending,
      error: projects.isError,
      sessionPending: sessions.isPending,
      sessionError: sessions.isError,
      sessionPlaceholder: sessions.isPlaceholderData,
    })),
    capture() {
      const activeDirectory = props.activeDirectory
      const key = ServerConnection.key(sdk.server)
      return {
        async inspect(workspace) {
          const [working, branch, sessions] = await Promise.all([
            sdk.api.vcs.status({ location: { directory: workspace.directory } }),
            sdk.api.vcs.diff({ location: { directory: workspace.directory }, mode: "branch" }),
            loadSessions([workspace.directory]),
          ])
          return {
            result: inspectWorkspaceDeletion({
              workspace: workspace.directory,
              activeDirectory,
              sessions,
              status: working.data.length || branch.data.length ? "dirty" : "clean",
            }),
            sessions,
          }
        },
        async remove(workspace, force) {
          await sdk.api.worktree.remove({ projectID: workspace.project.id, directory: workspace.directory, force })
        },
        async complete(workspace) {
          tabs.store.forEach((tab) => {
            if (tab.type !== "draft" || tab.server !== key) return
            const directoryMatches = containsDirectory(workspace.directory, tab.directory)
            const worktreeMatches = tab.worktree && containsDirectory(workspace.directory, tab.worktree)
            if (!directoryMatches && !worktreeMatches) return
            tabs.updateDraft(tab.draftID, {
              directory: directoryMatches ? workspace.project.worktree : tab.directory,
              worktree: undefined,
            })
          })
          extensions.workspaceRemoved({ server: key, directory: workspace.directory })
          await client.invalidateQueries({ queryKey: worktreeInventoryKey(sdk.scope, workspace.project.id) })
          await client.invalidateQueries({ queryKey: [sdk.scope, "settings-workspace-inventory"] })
        },
      }
    },
    notify: (toast) => showToast(toast),
  }
}
export function SettingsWorkspaces(props: {
  activeDirectory?: string
  resetProjectFilter?: () => number
  projectID?: string
}) {
  const services = createWorkspacesServices(props)
  return <ReactView component={Workspaces} props={{ services }} />
}
