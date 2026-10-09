import type { LocalProject } from "@/shell/state/layout"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { ProjectTile } from "@/shell/layout/project-tile"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Show } from "solid-js"

export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  server: ServerConnection.Key
}) {
  const state = useSessionTabAvatarState(
    () => props.server,
    () => props.sessionId,
    () => true,
  )

  return (
    <SessionTabAvatarView
      project={props.project}
      directory={props.directory}
      unread={state.unread()}
      loading={state.loading()}
    />
  )
}

export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  unread: boolean
  loading: boolean
}) {
  return (
    <Show
      when={props.loading}
      fallback={<ProjectTile project={props.project ?? { worktree: props.directory }} unread={props.unread} />}
    >
      <SessionProgressIndicatorV2 />
    </Show>
  )
}
