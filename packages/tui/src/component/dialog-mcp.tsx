import { createMemo, createSignal, onCleanup } from "solid-js"
import { reconcile } from "solid-js/store"
import { useSync } from "../context/sync"
import { useProject } from "../context/project"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

export function DialogMcp() {
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [loading, setLoading] = createSignal<string | true>()
  const abort = new AbortController()
  onCleanup(() => abort.abort())

  const options = createMemo<DialogSelectOption<{ name?: string }>[]>(() => [
    ...Object.entries(sync.data.mcp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, status]) => ({
        value: { name },
        title: name,
        description: status.status === "failed" ? status.error : status.status,
        footer:
          loading() === true || loading() === name
            ? "Updating…"
            : status.status === "connected"
              ? "✓ Enabled"
              : "○ Disabled",
        category: "Servers",
      })),
    {
      value: {},
      title: "Reload all MCPs",
      description: "Reread configuration and reconnect enabled servers",
      category: "Actions",
    },
  ])

  async function run(operation: "reload" | "toggle", name?: string) {
    if (loading() !== undefined || (operation === "toggle" && !name)) return
    const workspace = project.workspace.current()
    setLoading(name ?? true)
    try {
      // A requested reload may finish after this dialog closes; only cancel its UI refresh.
      const status =
        operation === "reload"
          ? await sdk.client.mcp.reload({ name, workspace }, { throwOnError: true })
          : await (
              sync.data.mcp[name!]?.status === "connected"
                ? sdk.client.mcp.disconnect({ name: name!, workspace }, { throwOnError: true })
                : sdk.client.mcp.connect({ name: name!, workspace }, { throwOnError: true })
            ).then(() => sdk.client.mcp.status({ workspace }, { throwOnError: true, signal: abort.signal }))
      if (abort.signal.aborted || project.workspace.current() !== workspace) return
      sync.set("mcp", reconcile(status.data))
      const failed = Object.entries(status.data).filter(
        ([key, item]) => (!name || key === name) && item.status !== "connected" && item.status !== "disabled",
      )
      toast.show({
        variant: failed.length ? "warning" : "success",
        message: failed.length
          ? `${failed.length} MCP server(s) need attention. See the status in /mcps.`
          : operation === "reload"
            ? "MCP reload complete. Session kept open."
            : "MCP connection updated.",
      })
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
      footer={<text fg={theme.textMuted}>Reload between tool calls. The conversation stays open.</text>}
      actions={[
        {
          command: "dialog.mcp.toggle",
          title: "toggle",
          disabled: (option) => !option?.value.name,
          onTrigger: (option) => void run("toggle", option.value.name),
        },
        { command: "dialog.mcp.reload", title: "reload", onTrigger: (option) => void run("reload", option.value.name) },
      ]}
      onSelect={(option) => void run("reload", option.value.name)}
    />
  )
}
