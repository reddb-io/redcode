import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { useTerminalDimensions } from "@opentui/solid"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

// Threshold under which a single-column sidebar is the only sensible layout: the
// conversation needs room to breathe even after we deduct the sidebar width.
const SINGLE_COLUMN_MAX_WIDTH = 120
const COLUMN_WIDTH = 36

export function Sidebar(props: { sessionID: string; overlay?: boolean; wide?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  // Two columns only when the caller signals wide AND the terminal can host both
  // columns without starving the conversation; overlay mode keeps a single column.
  const useTwoColumns = createMemo(() => {
    if (props.overlay) return false
    if (!props.wide) return false
    return dimensions().width > SINGLE_COLUMN_MAX_WIDTH
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={useTwoColumns() ? COLUMN_WIDTH * 2 + 1 : COLUMN_WIDTH}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <box flexShrink={0} gap={1} paddingRight={1}>
          <pluginRuntime.Slot
            name="sidebar_title"
            mode="single_winner"
            session_id={props.sessionID}
            title={session()!.title}
            share_url={session()!.share?.url}
          >
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session()!.title}</b>
              </text>
              <Show when={InstallationChannel !== "latest"}>
                <text fg={theme.textMuted}>{props.sessionID}</text>
              </Show>
              <Show when={session()!.workspaceID}>
                <text fg={theme.textMuted}>
                  <Show
                    when={workspace()}
                    fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                  >
                    {(item) => (
                      <WorkspaceLabel
                        type={item().type}
                        name={item().name}
                        status={project.workspace.status(item().id) ?? "error"}
                        icon
                      />
                    )}
                  </Show>
                </text>
              </Show>
              <Show when={session()!.share?.url}>
                <text fg={theme.textMuted}>{session()!.share!.url}</text>
              </Show>
            </box>
          </pluginRuntime.Slot>
        </box>

        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <Show
            when={useTwoColumns()}
            fallback={
              <box flexShrink={0} gap={1} paddingRight={1}>
                <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
                <pluginRuntime.Slot name="sidebar_project" session_id={props.sessionID} />
              </box>
            }
          >
            <box flexDirection="row" flexShrink={0} gap={1} paddingRight={1}>
              <box width={COLUMN_WIDTH} gap={1}>
                <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              </box>
              <box width={COLUMN_WIDTH} gap={1}>
                <pluginRuntime.Slot name="sidebar_project" session_id={props.sessionID} />
              </box>
            </box>
          </Show>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID} />
        </box>
      </box>
    </Show>
  )
}
