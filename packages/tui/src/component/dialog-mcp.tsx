import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode/client"
import { useToast } from "../ui/toast"
import { DialogErrorDetails } from "./dialog-error-details"
import { DialogIntegration } from "./dialog-integration"
import { useLocation } from "../context/location"

function statusError(status: McpServer["status"]) {
  if (status.status === "failed" || status.status === "needs_auth") return status.error
  return undefined
}

function Status(props: { status: McpServer["status"]; loading: boolean }) {
  if (props.loading || props.status.status === "pending") {
    return <>Connecting …</>
  }
  if (props.status.status === "connected") {
    return <span style={{ attributes: TextAttributes.BOLD }}>Connected ✓</span>
  }
  if (props.status.status === "failed") {
    return <>Failed !</>
  }
  if (props.status.status === "needs_auth") {
    return <>Sign in required →</>
  }
  return <>Disabled ○</>
}

export function DialogMcp(props: { initialServer?: string; details?: boolean } = {}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const location = useLocation()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const current = () => location.ref ?? data.location.default()
  const servers = createMemo(() =>
    pipe(
      data.location.mcp.server.list(current()) ?? [],
      sortBy((server) => server.name),
    ),
  )
  const initial = props.initialServer ? servers().find((server) => server.name === props.initialServer) : undefined
  const [focused, setFocused] = createSignal<string | undefined>(props.initialServer)
  const [detail, setDetail] = createSignal<McpServer | undefined>(
    props.details && initial?.status.status === "failed" ? initial : undefined,
  )
  const [loading, setLoading] = createSignal<ReadonlySet<string>>(new Set())
  const [actions, setActions] = createSignal<string>()
  const actionServer = createMemo(() => servers().find((server) => server.name === actions()))

  const statusColor = (status: McpServer["status"]) => {
    if (status.status === "connected") return theme.text.feedback.success.base
    if (status.status === "failed") return theme.text.feedback.error.base
    if (status.status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const options = createMemo(() => {
    const loadingMcp = loading()
    return servers().map((server) => {
      const pending = loadingMcp.has(server.name) || server.status.status === "pending"
      return {
        value: server.name,
        title: server.name,
        footer: <Status status={server.status} loading={pending} />,
        footerColor: pending ? theme.text.muted : statusColor(server.status),
      }
    })
  })

  const focusedServer = createMemo(() => servers().find((server) => server.name === focused()))

  const toggleTitle = createMemo(() => {
    const status = focusedServer()?.status.status
    if (status === "connected") return "disconnect"
    if (status === "failed") return "retry"
    if (status === "needs_auth") return "sign in"
    return "connect"
  })

  const select = (name: string | undefined) => {
    const server = servers().find((entry) => entry.name === name)
    if (!server) return
    if (server.status.status === "needs_auth" && server.integrationID) {
      dialog.replace(() => (
        <DialogIntegration
          integrationID={server.integrationID}
          autoConnect
          onConnected={() => dialog.replace(() => <DialogMcp initialServer={server.name} />)}
        />
      ))
      return
    }
    setActions(name)
  }

  // Auth-gated servers enter the integration flow; other inactive states retry the connection.
  // The mcp.status.changed event refreshes the list, so no manual sync is needed.
  const toggle = (name: string) => {
    if (loading().has(name)) return
    const server = servers().find((entry) => entry.name === name)
    if (!server || server.status.status === "pending") return
    if (server.status.status === "needs_auth" && server.integrationID) {
      select(name)
      return
    }
    setLoading((prev) => new Set(prev).add(name))
    const target = current()
    const input = { server: name, location: { directory: target.directory } }
    const call = server.status.status === "connected" ? client.api.mcp.disconnect(input) : client.api.mcp.connect(input)
    void call.catch(toast.error).finally(() =>
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      }),
    )
  }

  const reconnect = (server: McpServer) => {
    if (loading().has(server.name)) return
    setLoading((previous) => new Set(previous).add(server.name))
    const input = { server: server.name, location: { directory: current().directory } }
    void client.api.mcp
      .disconnect(input)
      .then(() => client.api.mcp.connect(input))
      .catch(toast.error)
      .finally(() =>
        setLoading((previous) => {
          const next = new Set(previous)
          next.delete(server.name)
          return next
        }),
      )
  }

  return (
    <box>
      <Show
        when={!actionServer()}
        fallback={
          <DialogSelect
            title={`MCP: ${actionServer()!.name}`}
            options={[
              {
                value: "toggle",
                title:
                  actionServer()!.status.status === "connected" ? "Disconnect for this run" : "Connect for this run",
              },
              { value: "reconnect", title: "Reconnect this MCP server" },
              ...(actionServer()!.integrationID
                ? [{ value: "auth", title: "Sign in again or manage saved accounts" }]
                : []),
              ...(statusError(actionServer()!.status) ? [{ value: "error", title: "View connection error" }] : []),
              { value: "back", title: "Back to MCP servers" },
            ]}
            onSelect={(option) => {
              const server = actionServer()!
              setActions(undefined)
              if (option.value === "toggle") toggle(server.name)
              if (option.value === "reconnect") reconnect(server)
              if (option.value === "error") setDetail(server)
              if (option.value === "auth" && server.integrationID)
                dialog.replace(() => (
                  <DialogIntegration
                    integrationID={server.integrationID}
                    autoConnect
                    onConnected={() => dialog.replace(() => <DialogMcp initialServer={server.name} />)}
                  />
                ))
            }}
          />
        }
      >
        <Show
          when={detail()}
          fallback={
            <DialogSelect
              title="MCP servers"
              options={options()}
              preserveSelection
              focusTarget={props.initialServer}
              onMove={(option) => setFocused(option.value as string)}
              onSelect={(option) => select(option.value as string)}
              actions={[
                {
                  title: toggleTitle(),
                  command: "dialog.mcp.toggle",
                  onTrigger: (option) => {
                    setFocused(option.value as string)
                    toggle(option.value as string)
                  },
                },
              ]}
              footer={<text fg={theme.text.muted}>enter for connection and sign-in actions</text>}
            />
          }
        >
          {(server) => (
            <DialogErrorDetails
              title={`MCP server: ${server().name}`}
              error={statusError(server().status) ?? "Unknown MCP connection error"}
              context={`Status: ${server().status.status}\nConfiguration: mcp.servers.${server().name}${
                server().integrationID ? `\nIntegration: ${server().integrationID}` : ""
              }`}
              onBack={() => {
                setDetail(undefined)
                dialog.setSize("medium")
              }}
            />
          )}
        </Show>
      </Show>
    </box>
  )
}
