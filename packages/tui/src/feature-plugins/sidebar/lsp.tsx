import type { ConfigEntry } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { errorMessage } from "../../util/error"

export function SidebarLsp(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const [open, setOpen] = createSignal(true)
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location)
  const [servers, { refetch }] = createResource(location, (location) =>
    Promise.all([props.context.client.lsp.status({ location }), props.context.client.config.get({ location })]).then(
      ([result, config]) => ({
        data: result.data,
        disabled:
          config.findLast(
            (entry): entry is Extract<ConfigEntry, { type: "document" }> =>
              entry.type === "document" && entry.info.lsp !== undefined,
          )?.info.lsp === false,
        error: undefined,
      }),
      (error: unknown) => ({ data: [], disabled: false, error: errorMessage(error) }),
    ),
  )
  const timer = setInterval(() => {
    if (!servers.loading) void refetch()
  }, 5_000)
  onCleanup(() => clearInterval(timer))

  return (
    <box>
      <text fg={theme.text.action.secondary.base} onMouseUp={() => setOpen(!open())}>
        <b>{open() ? "▼" : "▶"} LSP</b>
      </text>
      <Show when={open()}>
        <Show when={servers()?.error}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            LSP unavailable: {servers()?.error}
          </text>
        </Show>
        <Show when={!servers()?.error && !servers()?.data.length}>
          <text fg={theme.text.muted} wrapMode="word">
            {servers()?.disabled
              ? "LSPs are disabled"
              : servers.loading
                ? "Loading language servers…"
                : "LSPs will activate as files are read"}
          </text>
        </Show>
        <For each={servers()?.data}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                fg={item.status === "connected" ? theme.text.feedback.success.base : theme.text.feedback.error.base}
              >
                •
              </text>
              <text fg={theme.text.muted} wrapMode="word">
                {item.id} {item.root}
                {item.status === "error" ? ` (failed${item.error ? `: ${item.error}` : ""})` : ""}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "redcode.sidebar.lsp",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarLsp context={context} sessionID={props.sessionID} />,
    })
  },
})
