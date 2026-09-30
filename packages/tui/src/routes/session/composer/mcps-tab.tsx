import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { McpServer, McpTool } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../../../context/client"
import { useData } from "../../../context/data"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { useDialog } from "../../../ui/dialog"
import { DialogPrompt } from "../../../ui/dialog-prompt"
import { DialogSelect } from "../../../ui/dialog-select"
import { DialogConfirm } from "../../../ui/dialog-confirm"
import { DialogMcp } from "../../../component/dialog-mcp"
import { DialogIntegration } from "../../../component/dialog-integration"
import { useToast } from "../../../ui/toast"
import { useComposerTab } from "./context"

export function McpsTab(props: { sessionID: string }) {
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  const composer = useComposerTab()
  const shortcuts = Keymap.useShortcuts()
  const dialog = useDialog()
  const toast = useToast()
  const location = () => data.session.get(props.sessionID)?.location ?? data.location.default()
  const servers = createMemo(() =>
    (data.location.mcp.server.list(location()) ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
  )
  const [selected, setSelected] = createSignal(0)
  const [expanded, setExpanded] = createSignal<string | undefined>()
  const [tools, setTools] = createSignal<McpTool[]>([])
  const [loadingTools, setLoadingTools] = createSignal(false)
  const [busy, setBusy] = createSignal<string | undefined>()
  const current = createMemo(() => servers()[selected()])
  const currentTools = createMemo(() => tools().filter((tool) => tool.server === expanded()))
  let scroll: ScrollBoxRenderable | undefined

  const refresh = () => {
    const target = location()
    setLoadingTools(true)
    void client.api.mcp
      .tools({ location: { directory: target.directory } })
      .then((result) => setTools(result.data))
      .catch(toast.error)
      .finally(() => setLoadingTools(false))
  }

  createEffect(() => {
    if (!composer.active("mcps")) return
    location()
    refresh()
  })
  createEffect(() => {
    if (selected() >= servers().length) setSelected(Math.max(0, servers().length - 1))
    if (expanded() && !servers().some((server) => server.name === expanded())) setExpanded(undefined)
  })
  createEffect(() => {
    if (!scroll || !composer.active("mcps")) return
    const target = scroll.getChildren()[selected()]
    if (!target) return
    const y = target.y - scroll.y
    if (y >= scroll.height || y < 0) scroll.scrollBy(y - Math.floor(scroll.height / 2))
  })
  onCleanup(
    client.event.on("mcp.status.changed", (event) => {
      if (composer.active("mcps") && event.location?.directory === location().directory) refresh()
    }),
  )

  const operate = (server: McpServer, action: "connect" | "disconnect" | "remove") => {
    if (busy()) return
    setBusy(server.name)
    const input = { server: server.name, location: { directory: location().directory } }
    void client.api.mcp[action](input)
      .then(() => {
        if (action === "remove") setExpanded(undefined)
        toast.show({
          variant: "success",
          message: `${server.name}: ${action === "remove" ? "turned off for this run" : action === "connect" ? "connected" : "disconnected"}`,
        })
        refresh()
      })
      .catch(toast.error)
      .finally(() => setBusy(undefined))
  }

  const operateAll = (action: "restart" | "reload") => {
    if (busy()) return
    setBusy(action)
    void client.api.mcp[action]({ location: { directory: location().directory } })
      .then(() => {
        toast.show({
          variant: "success",
          message: action === "restart" ? "MCP servers reconnected" : "MCP configuration reloaded",
        })
        refresh()
      })
      .catch(toast.error)
      .finally(() => setBusy(undefined))
  }

  // Reconnecting drops every live connection, so it asks first; reloading config only touches changed servers.
  const restart = () => {
    if (!servers().some((server) => server.status.status === "connected")) {
      operateAll("restart")
      return
    }
    dialog.replace(() => (
      <DialogConfirm
        title="Reconnect all MCP servers"
        message="Close every live MCP connection and reconnect the enabled servers? Running tool calls may fail."
        onConfirm={() => operateAll("restart")}
      />
    ))
  }

  const connect = (server: McpServer) => {
    const integrationID = server.integrationID
    if (server.status.status === "needs_auth" && integrationID) {
      dialog.replace(() => <DialogIntegration integrationID={integrationID} autoConnect />)
      return
    }
    operate(server, "connect")
  }

  const add = () => {
    dialog.replace(() => (
      <DialogSelect
        title="Add MCP server for this run"
        options={[
          { value: "remote", title: "Remote URL" },
          { value: "local", title: "Local command" },
        ]}
        onSelect={(option) => {
          const type = option.value as "remote" | "local"
          dialog.replace(() => (
            <DialogPrompt
              title="MCP server name"
              placeholder="my-server"
              onCancel={() => dialog.clear()}
              onConfirm={(value) => {
                const name = value.trim()
                if (!name || servers().some((server) => server.name === name)) {
                  toast.show({ variant: "error", message: "Enter a new server name" })
                  return
                }
                dialog.replace(() => (
                  <DialogPrompt
                    title={type === "remote" ? "MCP server URL" : "MCP command (JSON array)"}
                    placeholder={type === "remote" ? "https://example.com/mcp" : '["npx", "-y", "server-package"]'}
                    onCancel={() => dialog.clear()}
                    onConfirm={(value) => {
                      const config =
                        type === "remote"
                          ? URL.canParse(value.trim()) && /^https?:$/.test(new URL(value.trim()).protocol)
                            ? { type, url: value.trim() }
                            : undefined
                          : (() => {
                              try {
                                const command: unknown = JSON.parse(value)
                                return Array.isArray(command) &&
                                  command.length > 0 &&
                                  command.every((part) => typeof part === "string" && part.length > 0)
                                  ? { type, command: command as string[] }
                                  : undefined
                              } catch {
                                return undefined
                              }
                            })()
                      if (!config) {
                        toast.show({
                          variant: "error",
                          message:
                            type === "remote"
                              ? "Enter a valid HTTP URL"
                              : "Enter a nonempty JSON array of command arguments",
                        })
                        return
                      }
                      dialog.clear()
                      setBusy(name)
                      void client.api.mcp
                        .add({ server: name, config, location: { directory: location().directory } })
                        .then(() => toast.show({ variant: "success", message: `${name} added for this run` }))
                        .catch(toast.error)
                        .finally(() => setBusy(undefined))
                    }}
                  />
                ))
              }}
            />
          ))
        }}
      />
    ))
  }

  const unload = (server: McpServer) => {
    dialog.replace(() => (
      <DialogConfirm
        title="Turn off MCP server"
        message={`Stop and remove ${server.name} from this run? Configured servers return after restart.`}
        onConfirm={() => operate(server, "remove")}
      />
    ))
  }

  onMount(() => {
    const cleanup = composer.register({
      id: "mcps",
      label: "MCPs",
      hints: () => [
        { label: "add", shortcut: shortcuts.get("composer.mcp.add") ?? "" },
        ...(current()
          ? [
              { label: "tools", shortcut: shortcuts.get("composer.mcp.tools") ?? "" },
              {
                label: current()?.status.status === "connected" ? "disconnect" : "connect",
                shortcut: shortcuts.get("composer.mcp.toggle") ?? "",
              },
              { label: "turn off", shortcut: shortcuts.get("composer.mcp.remove") ?? "" },
              { label: "reconnect all", shortcut: shortcuts.get("composer.mcp.restart") ?? "" },
            ]
          : []),
        { label: "reload config", shortcut: shortcuts.get("composer.mcp.reload") ?? "" },
      ],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("mcps"),
    priority: 1,
    commands: [
      {
        id: "composer.mcp.up",
        title: "Previous MCP server",
        group: "Composer",
        run: () => setSelected(Math.max(0, selected() - 1)),
      },
      {
        id: "composer.mcp.down",
        title: "Next MCP server",
        group: "Composer",
        run: () => setSelected(Math.min(servers().length - 1, selected() + 1)),
      },
      {
        id: "composer.mcp.tools",
        title: "Show MCP tools",
        group: "Composer",
        run: () => {
          const server = current()
          if (server) setExpanded(expanded() === server.name ? undefined : server.name)
        },
      },
      { id: "composer.mcp.add", title: "Add MCP server", group: "Composer", run: add },
      { id: "composer.mcp.refresh", title: "Refresh MCP tools", group: "Composer", run: refresh },
      {
        id: "composer.mcp.toggle",
        title: "Connect or disconnect MCP server",
        group: "Composer",
        run: () => {
          const server = current()
          if (server) server.status.status === "connected" ? operate(server, "disconnect") : connect(server)
        },
      },
      {
        id: "composer.mcp.remove",
        title: "Turn off MCP server",
        group: "Composer",
        run: () => {
          const server = current()
          if (server) unload(server)
        },
      },
      {
        id: "composer.mcp.restart",
        title: "Reconnect all MCP servers",
        group: "Composer",
        run: () => {
          if (servers().length > 0) restart()
        },
      },
      {
        id: "composer.mcp.reload",
        title: "Reload MCP configuration",
        group: "Composer",
        run: () => operateAll("reload"),
      },
    ],
  }))

  return (
    <Show when={composer.active("mcps")}>
      <Show
        when={servers().length > 0}
        fallback={
          <box height={5} paddingLeft={1}>
            <text fg={theme.text.muted}>No MCP servers</text>
            <text
              fg={theme.text.action.primary.base}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => operateAll("reload")}
            >
              reload config
            </text>
          </box>
        }
      >
        <scrollbox
          scrollbarOptions={{ visible: false }}
          height={5}
          ref={(value: ScrollBoxRenderable) => (scroll = value)}
        >
          <For each={servers()}>
            {(server, index) => (
              <box>
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    selected() === index()
                      ? theme.background.action.primary.focused
                      : theme.background.action.primary.base
                  }
                  onMouseMove={() => setSelected(index())}
                  onMouseUp={() => {
                    setSelected(index())
                    setExpanded(expanded() === server.name ? undefined : server.name)
                  }}
                >
                  <text
                    fg={selected() === index() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                    attributes={selected() === index() ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                    truncate
                    flexGrow={1}
                  >
                    {expanded() === server.name ? "▾" : "▸"} {server.name}
                  </text>
                  <text
                    fg={
                      server.status.status === "connected"
                        ? theme.text.feedback.success.base
                        : server.status.status === "failed"
                          ? theme.text.feedback.error.base
                          : server.status.status === "needs_auth"
                            ? theme.text.feedback.warning.base
                            : theme.text.muted
                    }
                    wrapMode="none"
                  >
                    {busy() === server.name || server.status.status === "pending"
                      ? "connecting"
                      : server.status.status === "needs_auth"
                        ? "sign in"
                        : server.status.status}
                  </text>
                </box>
                <Show when={expanded() === server.name}>
                  <Show
                    when={server.status.status === "connected"}
                    fallback={<text fg={theme.text.muted}> Connect to view tools</text>}
                  >
                    <Show
                      when={currentTools().length > 0}
                      fallback={
                        <text fg={theme.text.muted}> {loadingTools() ? "Loading tools…" : "No tools exposed"}</text>
                      }
                    >
                      <For each={currentTools()}>
                        {(tool) => (
                          <text fg={theme.text.muted} wrapMode="none" truncate>
                            {" "}
                            {tool.name}
                            {tool.description ? ` — ${tool.description}` : ""}
                          </text>
                        )}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={current()}>
        {(server) => (
          <box flexDirection="row" gap={2} paddingLeft={1}>
            <text fg={theme.text.action.primary.base} attributes={TextAttributes.UNDERLINE} onMouseUp={add}>
              add
            </text>
            <text
              fg={theme.text.action.primary.base}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() =>
                server().status.status === "connected" ? operate(server(), "disconnect") : connect(server())
              }
            >
              {server().status.status === "connected" ? "disconnect" : "connect"}
            </text>
            <text
              fg={theme.text.action.destructive.base}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => unload(server())}
            >
              turn off
            </text>
            <text fg={theme.text.action.primary.base} attributes={TextAttributes.UNDERLINE} onMouseUp={restart}>
              reconnect all
            </text>
            <text
              fg={theme.text.action.primary.base}
              attributes={TextAttributes.UNDERLINE}
              onMouseUp={() => operateAll("reload")}
            >
              reload config
            </text>
            <Show when={server().status.status === "failed"}>
              <text
                fg={theme.text.muted}
                attributes={TextAttributes.UNDERLINE}
                onMouseUp={() => dialog.replace(() => <DialogMcp initialServer={server().name} details />)}
              >
                details
              </text>
            </Show>
          </box>
        )}
      </Show>
    </Show>
  )
}
