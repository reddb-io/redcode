import { SessionTodo } from "@opencode/schema/session-todo"
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

const CLOSED_WINDOW_MS = 15 * 60 * 1000
// An expanded task shows its whole content; the request quote and the proof are only context for
// it, and a request can run to thousands of characters, so they stop after about a dozen lines.
const DETAIL_WIDTH = 480

export function SidebarTodo(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const dimensions = useTerminalDimensions()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string>()
  const [clock, setClock] = createSignal(Date.now())
  const agent = () => props.context.data.session.get(props.sessionID)?.agent ?? "build"
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
    SessionTodo.forAgent(tasks()?.data ?? [], agent()).filter(
      (item) =>
        (item.status !== "completed" && item.status !== "cancelled") ||
        (item.closedAt !== undefined && clock() - item.closedAt < CLOSED_WINDOW_MS),
    ),
  )
  const shown = createMemo(() => (all() ? visible() : visible().slice(0, Math.max(3, dimensions().height - 20))))

  return (
    <Show when={visible().length > 0 || tasks()?.error}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => visible().length > 2 && setOpen(!open())}>
          <Show when={visible().length > 2}>
            <text fg={theme.text.action.primary.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.action.primary.base}>
            <b>Todo · {agent() === "design" ? "Design" : agent() === "plan" ? "Plan / Design" : "Build"}</b>
          </text>
        </box>
        <Show when={tasks()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            Tasks unavailable: {tasks()?.error}
          </text>
        </Show>
        <Show when={visible().length <= 2 || open()}>
          <For each={shown()}>
            {(item) => {
              const key = item.id ?? item.content
              const tone = ["in_progress", "blocked"].includes(item.status)
                ? theme.text.feedback.warning.base
                : theme.text.muted
              // Collapsed, a task takes its title line and at most one reason line, however long the
              // model wrote it; a click shows the full task and what it is checked against.
              return (
                <box onMouseUp={() => setExpanded(expanded() === key ? undefined : key)}>
                  <box flexDirection="row" gap={0}>
                    <text flexShrink={0} fg={tone}>
                      [
                      {item.status === "completed"
                        ? "✓"
                        : item.status === "cancelled"
                          ? "−"
                          : item.status === "in_progress"
                            ? "•"
                            : item.status === "blocked"
                              ? "!"
                              : " "}
                      ]{" "}
                    </text>
                    <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={tone}>
                      {SessionTodo.label(item)}
                    </text>
                  </box>
                  <Show
                    when={expanded() === key}
                    fallback={
                      <Show when={item.reason}>
                        {(reason) => (
                          <text paddingLeft={4} wrapMode="none" truncate fg={theme.text.muted}>
                            {SessionTodo.label({ content: reason() })}
                          </text>
                        )}
                      </Show>
                    }
                  >
                    <box paddingLeft={4}>
                      <text wrapMode="word" fg={theme.text.base}>
                        {item.content}
                      </text>
                      <For
                        each={[
                          ["Done when", item.criterion !== item.content ? item.criterion : undefined],
                          ["Reason", item.reason],
                          ["Requested", item.source?.quote],
                          ["Evidence", item.evidence?.explanation],
                        ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))}
                      >
                        {(entry) => (
                          <text wrapMode="word" fg={theme.text.muted}>
                            {entry[0]}: {Locale.truncateWidth(entry[1].trim(), DETAIL_WIDTH)}
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              )
            }}
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
