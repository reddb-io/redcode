import { createResource, createSignal, onCleanup } from "solid-js"
import { useSDK } from "../context/sdk"
import { useProject } from "../context/project"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { DialogAlert } from "../ui/dialog-alert"
import { useToast } from "../ui/toast"
import type { Monitor } from "@reddb-io/redcode-schema/monitor"

export function DialogMonitors(props: { sessionID: string }) {
  const sdk = useSDK()
  const project = useProject()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const query = () => ({ sessionID: props.sessionID, workspace: project.workspace.current() })
  const [items, { refetch }] = createResource(async () => {
    const result = await sdk.client.experimental.monitors.list(query()).catch(() => undefined)
    setFailed(!result || !!result.error)
    return result?.data ?? []
  })
  const timer = setInterval(() => {
    if (!items.loading && !busy()) void refetch()
  }, 2_000)
  onCleanup(() => clearInterval(timer))

  function details(info: Monitor.Info) {
    dialog.replace(() => (
      <DialogSelect
        title={`${info.status}: ${info.command}`}
        locked={busy()}
        options={[
          { title: "View last result", value: "result", description: `${info.attempts} checks · ${info.workdir}` },
          ...(info.status === "running"
            ? [
                {
                  title: "Stop monitoring",
                  value: "cancel",
                  description: "Stops the local command/checks. The external job keeps running.",
                },
              ]
            : []),
          { title: "Back to monitors", value: "back" },
        ]}
        onSelect={async (option) => {
          if (option.value === "back") return dialog.replace(() => <DialogMonitors {...props} />)
          if (option.value === "result") {
            await DialogAlert.show(
              dialog,
              `Monitor ${info.status}`,
              [
                info.error,
                info.evidence?.output ?? "No result yet.",
                info.evidence?.outputPath ? `Full output: ${info.evidence.outputPath}` : undefined,
              ]
                .filter(Boolean)
                .join("\n\n"),
            )
            dialog.replace(() => <DialogMonitors {...props} />)
            return
          }
          setBusy(true)
          const result = await sdk.client.experimental.monitors
            .cancel({ ...query(), monitorID: info.id })
            .catch(() => undefined)
          setBusy(false)
          toast.show({
            variant: result?.data ? "success" : "error",
            message: result?.data ? `Monitor: ${result.data.status}` : "Could not stop monitor.",
          })
          dialog.replace(() => <DialogMonitors {...props} />)
        }}
      />
    ))
  }

  return (
    <DialogSelect
      title={items.loading && !items() ? "Loading monitors…" : "Session monitors"}
      placeholder="Search commands"
      emptyView={
        <text>
          {failed()
            ? "Could not load monitors. Reopen /monitors to retry."
            : items.loading
              ? "Loading…"
              : "No monitors in this session."}
        </text>
      }
      options={(items() ?? []).toReversed().map((info) => ({
        title: info.command,
        value: info.id,
        description: info.status,
        footer: `${info.attempts} checks · ${info.options.mode}`,
        onSelect: () => details(info),
      }))}
    />
  )
}
