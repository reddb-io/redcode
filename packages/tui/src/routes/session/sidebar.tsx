import { useData } from "../../context/data"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { sessionFamily } from "../../util/session"
import { useConfig } from "../../config"
import { Slot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { TextAttributes } from "@opentui/core"
import "../../component/title-shimmer"

import { getScrollAcceleration } from "../../util/scroll"

export const SIDEBAR_TABS = ["context", "workers", "subagents"] as const
export type SidebarTab = (typeof SIDEBAR_TABS)[number]

export function Sidebar(props: {
  sessionID: string
  width: number
  overlay?: boolean
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}) {
  const data = useData()
  const theme = useTheme()
  const config = useConfig().data
  const route = useRoute()
  const children = createMemo(() => sessionFamily(data.session.list(), props.sessionID))
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <Show when={session()}>
      <box
        id="session-sidebar"
        backgroundColor={theme.background.raised.base}
        width={props.width}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <box flexShrink={0} paddingRight={2} paddingBottom={1}>
          <title_shimmer
            fg={theme.text.base}
            rename={{
              pending: data.session.title.pending(props.sessionID),
              title: withTimestampedFallback(session()),
            }}
            enabled={config.animations ?? true}
            backdrop={theme.background.raised.base}
            attributes={
              data.session.title.pending(props.sessionID) && config.animations === false
                ? TextAttributes.DIM
                : TextAttributes.BOLD
            }
          >
            {withTimestampedFallback(session())}
          </title_shimmer>
        </box>
        <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0} paddingBottom={1}>
          <For each={SIDEBAR_TABS}>
            {(item) => (
              <box flexDirection="row" onMouseUp={() => props.onTabChange(item)}>
                <text
                  fg={props.tab === item ? theme.text.action.primary.selected : theme.text.action.secondary.base}
                  attributes={props.tab === item ? TextAttributes.BOLD : undefined}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </text>
                <Show when={item === "subagents" && children().length > 0}>
                  <text fg={theme.text.muted}>{` (${children().length})`}</text>
                </Show>
                <Show when={item === "workers"}>
                  <Slot path="sidebar.workers.count" input={{ sessionID: props.sessionID }} />
                </Show>
              </box>
            )}
          </For>
        </box>
        <Show when={props.tab === "workers"}>
          <box flexGrow={1} minHeight={0}>
            <Slot path="sidebar.workers" input={{ sessionID: props.sessionID, width: Math.max(1, props.width - 4) }} />
          </box>
        </Show>
        <Show when={props.tab !== "workers"}>
          <scrollbox
            flexGrow={1}
            minHeight={0}
            scrollAcceleration={scrollAcceleration()}
            // The sidebar only scrolls vertically; a horizontal bar steals a row during initial layout.
            horizontalScrollbarOptions={{ visible: false }}
            verticalScrollbarOptions={{
              // Use the content's reserved right padding instead of changing its width when the bar toggles.
              position: "absolute",
              right: 0,
              top: 0,
              width: 1,
              height: "100%",
              trackOptions: {
                backgroundColor: theme.background.raised.base,
                foregroundColor: theme.scrollbar.base,
              },
            }}
          >
            <box flexShrink={0} gap={1} paddingRight={1}>
              <Show when={props.tab === "context"}>
                <Slot path="sidebar.content" input={{ sessionID: props.sessionID }} />
              </Show>
              <Show when={props.tab === "subagents"}>
                <Show
                  when={children().length}
                  fallback={<text fg={theme.text.muted}>No subagents in this session.</text>}
                >
                  <For each={children()}>
                    {(entry) => (
                      <box onMouseUp={() => route.navigate({ type: "session", sessionID: entry.session.id })}>
                        <text fg={theme.text.action.primary.base} wrapMode="word">
                          {entry.prefix}
                          {entry.session.agent ?? "Subagent"}: {withTimestampedFallback(entry.session)}
                        </text>
                        <text fg={theme.text.muted}>{data.session.status(entry.session.id)}</text>
                      </box>
                    )}
                  </For>
                </Show>
              </Show>
            </box>
          </scrollbox>
        </Show>

        <Show when={props.tab === "context"}>
          <box flexShrink={0} gap={1} paddingTop={1}>
            <Slot path="sidebar.footer" input={{ sessionID: props.sessionID }} />
          </box>
        </Show>
      </box>
    </Show>
  )
}
