import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { errorMessage } from "../../util/error"

const CLOSED_WINDOW_MS = 15 * 60 * 1000

export function SidebarTodo(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const dimensions = useTerminalDimensions()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [clock, setClock] = createSignal(Date.now())
  const [tasks, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) =>
      props.context.client.session.todo.list({ sessionID }).then(
        (data) => ({ data, error: undefined }),
        (error: unknown) => ({ data: [], error: errorMessage(error) }),
      ),
  )
  const timer = setInterval(() => {
    setClock(Date.now())
    if (!tasks.loading) void refetch()
  }, 5_000)
  onCleanup(() => clearInterval(timer))
  const visible = createMemo(() =>
    (tasks()?.data ?? []).filter(
      (item) =>
        (item.status !== "completed" && item.status !== "cancelled") ||
        (item.closedAt !== undefined && clock() - item.closedAt < CLOSED_WINDOW_MS),
    ),
  )
  const shown = createMemo(() => (all() ? visible() : visible().slice(0, Math.max(3, dimensions().height - 20))))

  return (
    <Show when={visible().length > 0 || tasks()?.error}>
      <box>
        <text fg={theme.text.action.secondary.base} onMouseUp={() => setOpen(!open())}>
          <b>
            {open() ? "▼" : "▶"} Tasks ({visible().length})
          </b>
        </text>
        <Show when={tasks()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Tasks unavailable: {tasks()?.error}
          </text>
        </Show>
        <Show when={open()}>
          <For each={shown()}>
            {(item) => (
              <box>
                <text
                  fg={item.status === "blocked" ? theme.text.feedback.warning.base : theme.text.base}
                  wrapMode="word"
                >
                  {item.status === "completed"
                    ? "✓"
                    : item.status === "cancelled"
                      ? "−"
                      : item.status === "in_progress"
                        ? "◉"
                        : item.status === "blocked"
                          ? "!"
                          : "○"}{" "}
                  {item.content}
                </text>
                <Show when={item.reason}>
                  <text fg={theme.text.muted} wrapMode="word">
                    {item.reason}
                  </text>
                </Show>
              </box>
            )}
          </For>
          <Show when={visible().length > shown().length}>
            <text fg={theme.text.action.secondary.base} onMouseUp={() => setAll(true)}>
              +{visible().length - shown().length} more
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "redcode.sidebar.todo",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarTodo context={context} sessionID={props.sessionID} />,
    })
  },
})
