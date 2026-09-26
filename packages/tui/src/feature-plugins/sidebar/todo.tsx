import type { TuiPlugin, TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

// A closed task stays visible only while fresh; older ones fall away so the panel keeps showing
// the work that is left, not the whole thread's history.
const CLOSED_WINDOW_MS = 15 * 60 * 1000

// Rows the session sidebar spends around the task list: its padding, title and tabs, the location
// block pinned above the list, the Context section, and the list's own header and "+N more" line.
// A longer list is cut short so it does not push everything below it out of sight.
const SIDEBAR_ROWS = 20
const MIN_ITEMS = 3

/** The tasks the sidebar lists: every open one, and closed ones only while fresh. */
export function visibleTodos<T extends { status: string; closedAt?: number }>(list: readonly T[]) {
  const now = Date.now()
  return list.filter(
    (item) =>
      (item.status !== "completed" && item.status !== "cancelled") ||
      (item.closedAt !== undefined && now - item.closedAt < CLOSED_WINDOW_MS),
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const visible = createMemo(() => visibleTodos(props.api.state.session.todo(props.session_id)))
  const shown = createMemo(() =>
    all() ? visible() : visible().slice(0, Math.max(MIN_ITEMS, dimensions().height - SIDEBAR_ROWS)),
  )

  return (
    <Show when={visible().length > 0}>
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
          <For each={shown()}>
            {(item) => <TodoItem status={item.status} content={item.content} reason={item.reason} />}
          </For>
          <Show when={visible().length > shown().length}>
            <text fg={theme().textMuted} onMouseDown={() => setAll(true)}>
              +{visible().length - shown().length} more
            </text>
          </Show>
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
