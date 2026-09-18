import type { TuiPlugin, TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

// A closed task stays visible only while fresh; older ones fall away so the panel keeps showing
// the work that is left, not the whole thread's history.
const CLOSED_WINDOW_MS = 15 * 60 * 1000

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const visible = createMemo(() => {
    const now = Date.now()
    return list().filter(
      (item) =>
        (item.status !== "completed" && item.status !== "cancelled") ||
        (item.closedAt !== undefined && now - item.closedAt < CLOSED_WINDOW_MS),
    )
  })
  const show = createMemo(() => visible().length > 0)

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => visible().length > 2 && setOpen((x) => !x)}>
          <Show when={visible().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={visible().length <= 2 || open()}>
          <For each={visible()}>
            {(item) => <TodoItem status={item.status} content={item.content} reason={item.reason} />}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
