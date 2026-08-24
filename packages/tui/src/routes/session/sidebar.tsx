import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { MouseButton, type MouseEvent, TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel } from "@reddb-io/redcode-core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"
import { useRedskilled } from "../../context/redskilled"
import { Workers } from "../workers"

export type SidebarTab = "context" | "workers"

export function Sidebar(props: {
  sessionID: string
  overlay?: boolean
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  width: number
  onWidthDragStart: (x: number) => void
}) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const redskilled = useRedskilled()
  const renderer = useRenderer()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const workerCount = createMemo(() => redskilled.status()?.payload?.workers.length ?? 0)
  const failedWorkers = createMemo(
    () => redskilled.status()?.payload?.workers.filter((item) => item.display?.failed).length ?? 0,
  )

  return (
    <Show when={session()}>
      <box
        id="session-sidebar"
        backgroundColor={theme.backgroundPanel}
        width={props.width}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <box
          id="session-sidebar-resize"
          position="absolute"
          left={0}
          top={0}
          width={1}
          height="100%"
          zIndex={10}
          backgroundColor={theme.backgroundPanel}
          onMouseOver={() => renderer.setMousePointer("move")}
          onMouseOut={() => renderer.setMousePointer("default")}
          onMouseDown={(event: MouseEvent) => {
            if (event.button !== MouseButton.LEFT) return
            props.onWidthDragStart(event.x)
            event.preventDefault()
            event.stopPropagation()
          }}
        />

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

        <box flexDirection="row" flexShrink={0} gap={2} paddingTop={1} paddingBottom={1}>
          <text
            fg={props.tab === "context" ? theme.primary : theme.textMuted}
            attributes={props.tab === "context" ? TextAttributes.BOLD : undefined}
            onMouseUp={() => props.onTabChange("context")}
          >
            Context
          </text>
          <text
            fg={props.tab === "workers" ? theme.primary : theme.textMuted}
            attributes={props.tab === "workers" ? TextAttributes.BOLD : undefined}
            onMouseUp={() => props.onTabChange("workers")}
          >
            Workers
            <Show when={workerCount() > 0}>
              <span style={{ fg: failedWorkers() ? theme.error : theme.textMuted }}>
                {` (${workerCount()}${failedWorkers() ? ` ✗${failedWorkers()}` : ""})`}
              </span>
            </Show>
          </text>
        </box>

        <box visible={props.tab === "context"} flexGrow={1} minHeight={0}>
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
            <box flexShrink={0} gap={1} paddingRight={1}>
              <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              <pluginRuntime.Slot name="sidebar_project" session_id={props.sessionID} />
            </box>
          </scrollbox>

          <box flexShrink={0} gap={1} paddingTop={1}>
            <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID} />
          </box>
        </box>

        <box visible={props.tab === "workers"} flexGrow={1} minHeight={0}>
          <Workers active={props.tab === "workers"} width={props.width - 4} />
        </box>
      </box>
    </Show>
  )
}
