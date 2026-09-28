import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useToast } from "../../ui/toast"
import { sessionFamily } from "../../util/session"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"

export function SidebarSubagents(props: { sessionID: string }) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const children = createMemo(() => sessionFamily(data.session.list(), props.sessionID))

  const steer = (sessionID: string) => {
    dialog.replace(() => (
      <DialogPrompt
        title="Steer subagent"
        placeholder="What should it do differently?"
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const text = value.trim()
          if (!text) return
          dialog.clear()
          // Admission preserves the child's selected agent/model and delivers at its next safe boundary.
          void client.api.session
            .prompt({ sessionID, text, delivery: "steer" })
            .then(() => toast.show({ variant: "success", message: "Hint sent to the subagent" }))
            .catch(toast.error)
        }}
      />
    ))
  }
  const kill = (sessionID: string, title: string) => {
    dialog.replace(() => (
      <DialogConfirm
        title="Kill subagent"
        message={`Abort ${title}?`}
        onConfirm={() => {
          void client.api.session.interrupt({ sessionID }).catch(toast.error)
        }}
      />
    ))
  }

  return (
    <box flexShrink={0} gap={1}>
      <Show when={children().length === 0}>
        <text fg={theme.text.muted}>No subagents in this session.</text>
      </Show>
      <For each={children()}>
        {(entry) => {
          const running = () => data.session.status(entry.session.id) === "running"
          return (
            <box flexShrink={0}>
              <text fg={theme.text.base} wrapMode="none">
                {entry.prefix}
                <span style={{ fg: running() ? theme.text.feedback.info.base : theme.text.muted }}>
                  {running() ? "●" : "·"}
                </span>{" "}
                {withTimestampedFallback(entry.session).replace(/ \(@\w+ subagent\)$/, "")}
              </text>
              <text fg={theme.text.muted} paddingLeft={2} wrapMode="word">
                {data.session.status(entry.session.id)}
                <Show when={entry.session.model}>
                  {(model) => (
                    <>
                      {" · "}
                      {model().id}
                      {model().variant ? ` (${model().variant})` : ""}
                    </>
                  )}
                </Show>
              </text>
              <box flexDirection="row" gap={2} paddingLeft={2}>
                <text
                  id={`subagent-open-${entry.session.id}`}
                  fg={theme.text.action.primary.selected}
                  attributes={TextAttributes.UNDERLINE}
                  onMouseUp={() => route.navigate({ type: "session", sessionID: entry.session.id })}
                >
                  open
                </text>
                <Show when={running()}>
                  <text
                    id={`subagent-steer-${entry.session.id}`}
                    fg={theme.text.action.primary.base}
                    attributes={TextAttributes.UNDERLINE}
                    onMouseUp={() => steer(entry.session.id)}
                  >
                    steer
                  </text>
                  <text
                    id={`subagent-kill-${entry.session.id}`}
                    fg={theme.text.action.destructive.base}
                    bg={theme.background.action.destructive.base}
                    attributes={TextAttributes.UNDERLINE}
                    onMouseUp={() => kill(entry.session.id, withTimestampedFallback(entry.session))}
                  >
                    kill
                  </text>
                </Show>
              </box>
            </box>
          )
        }}
      </For>
    </box>
  )
}
