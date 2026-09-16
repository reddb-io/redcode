import type { McpServerInfo, McpStatus } from "@reddb-io/redcode-sdk/v2"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { reconcile } from "solid-js/store"
import { useSync } from "../context/sync"
import { useProject } from "../context/project"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import type { BrowserOpener } from "../util/browser"
import { DialogMcpAuth } from "./dialog-mcp-auth"
import { McpAuthPrompt } from "./mcp-auth-prompt"

type Operation = "reload" | "toggle" | "logout"

export type DialogMcpProps = {
  /** Injected in tests; forwarded to the sign-in flow. */
  opener?: BrowserOpener
  authTimeoutMs?: number
  /** An action chosen in the per-server menu, run once this list is back on screen. */
  initial?: { operation: Operation; name: string }
}

export function statusLabel(status: McpStatus) {
  switch (status.status) {
    case "connected":
      return "connected"
    case "disabled":
      return "disabled"
    case "needs_auth":
      return "needs auth"
    case "needs_client_registration":
      return "needs client registration"
    case "failed":
      return "failed"
  }
}

export function authLabel(info: McpServerInfo | undefined, now = Date.now()) {
  if (!info?.oauth || !info.auth) return undefined
  if (info.auth === "not_authenticated") return "not signed in"
  if (info.auth === "expired") return "token expired"
  if (!info.expiresAt) return "signed in"
  const minutes = Math.round((info.expiresAt * 1000 - now) / 60_000)
  if (minutes < 60) return `signed in, expires in ${Math.max(minutes, 1)}m`
  if (minutes < 48 * 60) return `signed in, expires in ${Math.round(minutes / 60)}h`
  return `signed in, expires in ${Math.round(minutes / (24 * 60))}d`
}

export function DialogMcp(props: DialogMcpProps = {}) {
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [loading, setLoading] = createSignal<string | true>()
  const [info, setInfo] = createSignal<Record<string, McpServerInfo>>({})
  const abort = new AbortController()
  onCleanup(() => abort.abort())

  async function loadInfo() {
    const workspace = project.workspace.current()
    // Older servers have no /mcp/info; the list still works from status alone.
    const result = await sdk.client.mcp.info({ workspace }, { signal: abort.signal }).catch(() => undefined)
    if (abort.signal.aborted || project.workspace.current() !== workspace || !result?.data) return
    setInfo(result.data)
  }
  onMount(() => {
    dialog.setSize("large")
    void loadInfo()
    if (props.initial) void run(props.initial.operation, props.initial.name)
  })

  const back = (initial?: DialogMcpProps["initial"]) =>
    dialog.replace(() => <DialogMcp opener={props.opener} authTimeoutMs={props.authTimeoutMs} initial={initial} />)

  const canAuth = (name: string) => {
    const status = sync.data.mcp[name]?.status
    return info()[name]?.oauth ?? status === "needs_auth"
  }

  const options = createMemo<DialogSelectOption<{ name?: string }>[]>(() => [
    ...Object.entries(sync.data.mcp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, status]) => {
        const details = info()[name]
        // A failure's own message says more than its label; keep it first so narrow dialogs still show it.
        const parts = [
          "error" in status ? status.error : statusLabel(status),
          status.status === "connected" && details ? `${details.tools} tool${details.tools === 1 ? "" : "s"}` : "",
          authLabel(details) ?? "",
        ].filter(Boolean)
        return {
          value: { name },
          title: name,
          description: parts.join(" · "),
          footer:
            loading() === true || loading() === name
              ? "Updating…"
              : status.status === "connected"
                ? "✓ Enabled"
                : status.status === "needs_auth"
                  ? "⚠ Sign in"
                  : "○ Disabled",
          category: "Servers",
        }
      }),
    {
      value: {},
      title: "Reload all MCPs",
      description: "Reread configuration and reconnect enabled servers",
      category: "Actions",
    },
  ])

  function authenticate(name: string) {
    if (loading() !== undefined || !canAuth(name)) return
    dialog.replace(() => (
      <DialogMcpAuth name={name} opener={props.opener} timeoutMs={props.authTimeoutMs} onDone={() => back()} />
    ))
  }

  async function logout(name: string) {
    if (loading() !== undefined || !canAuth(name)) return
    const confirmed = await DialogConfirm.show(
      dialog,
      `Log out of ${name}?`,
      `Removes the stored OAuth tokens and client registration for ${name}. The server stays configured; sign in again from /mcp.`,
    )
    back(confirmed ? { operation: "logout", name } : undefined)
  }

  function actions(name: string) {
    const status = sync.data.mcp[name]
    if (!status) return
    const authed = info()[name]?.auth === "authenticated"
    const items: DialogSelectOption<() => void>[] = []
    if (canAuth(name))
      items.push({
        title: authed ? "Re-authenticate" : "Authenticate",
        description: "Sign in through the browser and reconnect",
        value: () => authenticate(name),
      })
    if (canAuth(name) && info()[name]?.auth !== "not_authenticated")
      items.push({
        title: "Log out",
        description: "Remove stored credentials",
        value: () => void logout(name),
      })
    items.push({
      title: "Reconnect",
      description: "Reread configuration and reconnect this server",
      value: () => back({ operation: "reload", name }),
    })
    items.push({
      title: status.status === "disabled" ? "Enable" : "Disable",
      description: "For this session only; configuration files are not changed",
      value: () => back({ operation: "toggle", name }),
    })
    dialog.replace(() => (
      <DialogSelect
        title={name}
        options={items}
        onSelect={(option) => option.value()}
        footer={<text fg={theme.textMuted}>esc to close</text>}
      />
    ))
  }

  async function run(operation: Operation, name?: string) {
    if (loading() !== undefined || (operation !== "reload" && !name)) return
    const workspace = project.workspace.current()
    setLoading(name ?? true)
    try {
      // A requested reload may finish after this dialog closes; only cancel its UI refresh.
      const status =
        operation === "reload"
          ? await sdk.client.mcp.reload({ name, workspace }, { throwOnError: true })
          : await (
              operation === "logout"
                ? sdk.client.mcp.auth.remove({ name: name!, workspace }, { throwOnError: true }).then(() => {
                    // The user asked for this; the reconnect below reports needs_auth without a prompt.
                    McpAuthPrompt.acknowledge(name!)
                    return sdk.client.mcp.reload({ name, workspace }, { throwOnError: true })
                  })
                : sync.data.mcp[name!]?.status === "connected"
                  ? sdk.client.mcp.disconnect({ name: name!, workspace }, { throwOnError: true })
                  : sdk.client.mcp.connect({ name: name!, workspace }, { throwOnError: true })
            ).then(() => sdk.client.mcp.status({ workspace }, { throwOnError: true, signal: abort.signal }))
      if (abort.signal.aborted || project.workspace.current() !== workspace) return
      sync.set("mcp", reconcile(status.data))
      const failed = Object.entries(status.data).filter(
        ([key, item]) => (!name || key === name) && item.status !== "connected" && item.status !== "disabled",
      )
      toast.show({
        variant: operation === "logout" ? "info" : failed.length ? "warning" : "success",
        message:
          operation === "logout"
            ? `Logged out of ${name}. Its stored credentials were removed.`
            : failed.length
              ? `${failed.length} MCP server(s) need attention. See the status in /mcp.`
              : operation === "reload"
                ? "MCP reload complete. Session kept open."
                : "MCP connection updated.",
      })
      void loadInfo()
      const resources = await sdk.client.experimental.resource.list(
        { workspace },
        { throwOnError: true, signal: abort.signal },
      )
      if (abort.signal.aborted || project.workspace.current() !== workspace) return
      sync.set("mcp_resource", reconcile(resources.data))
    } catch (error) {
      if (!abort.signal.aborted && project.workspace.current() === workspace) toast.error(error)
    } finally {
      if (!abort.signal.aborted) setLoading(undefined)
    }
  }

  return (
    <DialogSelect
      title="MCP servers"
      options={options()}
      locked={loading() !== undefined}
      preserveSelection
      footer={<text fg={theme.textMuted}>enter: server actions</text>}
      actions={[
        {
          command: "dialog.mcp.authenticate",
          title: "sign in",
          disabled: (option) => !option?.value.name || !canAuth(option.value.name),
          onTrigger: (option) => authenticate(option.value.name!),
        },
        {
          command: "dialog.mcp.logout",
          title: "log out",
          disabled: (option) => !option?.value.name || !canAuth(option.value.name),
          onTrigger: (option) => void logout(option.value.name!),
        },
        {
          command: "dialog.mcp.toggle",
          title: "toggle",
          disabled: (option) => !option?.value.name,
          onTrigger: (option) => void run("toggle", option.value.name),
        },
        { command: "dialog.mcp.reload", title: "reload", onTrigger: (option) => void run("reload", option.value.name) },
      ]}
      onSelect={(option) => (option.value.name ? actions(option.value.name) : void run("reload"))}
    />
  )
}
