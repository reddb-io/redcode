import { Plugin } from "@opencode/plugin/tui"
import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { errorMessage } from "../../util/error"

export function SidebarFiles(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const [open, setOpen] = createSignal(true)
  const [files, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) =>
      props.context.client.session.diff({ sessionID, scope: "session", context: 0 }).then(
        (data) => ({ data, error: undefined }),
        (error: unknown) => ({ data: [], error: errorMessage(error) }),
      ),
  )
  const timer = setInterval(() => {
    if (!files.loading) void refetch()
  }, 5_000)
  onCleanup(() => clearInterval(timer))

  return (
    <Show when={files()?.data.length || files()?.error}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => (files()?.data.length ?? 0) > 2 && setOpen(!open())}>
          <Show when={(files()?.data.length ?? 0) > 2}>
            <text fg={theme.text.action.primary.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.action.primary.base}>
            <b>Modified Files</b>
          </text>
        </box>
        <Show when={files()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Files unavailable: {files()?.error}
          </text>
        </Show>
        <Show when={(files()?.data.length ?? 0) <= 2 || open()}>
          <For each={files()?.data}>
            {(item) => (
              <box flexDirection="row" gap={1} minWidth={0}>
                <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  {item.file}
                </text>
                <Show when={item.additions}>
                  <text fg={theme.diff.text.added} flexShrink={0}>
                    +{item.additions}
                  </text>
                </Show>
                <Show when={item.deletions}>
                  <text fg={theme.diff.text.removed} flexShrink={0}>
                    -{item.deletions}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "redcode.sidebar.files",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarFiles context={context} sessionID={props.sessionID} />,
    })
  },
})
