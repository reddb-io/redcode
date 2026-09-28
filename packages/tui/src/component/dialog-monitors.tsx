import { type MonitorPublicInfo } from "@opencode/client"
import { Monitor } from "@opencode/schema/monitor"
import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogMonitors(props: { sessionID: string }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const [selected, setSelected] = createSignal<string>()
  const [result, setResult] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [items, { refetch }] = createResource(
    () => props.sessionID,
    (sessionID) =>
      client.api.session.monitor.list({ sessionID }).then(
        (data) => ({ data, error: undefined }),
        (error: unknown) => ({ data: [], error: errorMessage(error) }),
      ),
  )
  const current = createMemo(() => items()?.data.find((info) => info.id === selected()))
  const timer = setInterval(() => {
    if (!items.loading && !busy()) void refetch()
  }, 2_000)
  onCleanup(() => clearInterval(timer))

  async function cancel(info: MonitorPublicInfo) {
    setBusy(true)
    await client.api.session.monitor
      .cancel({ sessionID: props.sessionID, monitorID: info.id })
      .then(
        async (updated) => {
          toast.show({ variant: "success", message: `Monitor: ${updated.status}` })
          await refetch()
        },
        (error: unknown) => toast.error(error),
      )
      .finally(() => setBusy(false))
  }

  return (
    <Show
      when={current()}
      fallback={
        <DialogSelect
          title="Session monitors"
          placeholder="Search commands"
          emptyView={
            <text fg={items()?.error ? theme.text.feedback.error.base : theme.text.muted}>
              {items()?.error
                ? `Could not load monitors: ${items()?.error}`
                : items.loading
                  ? "Loading…"
                  : "No monitors in this session."}
            </text>
          }
          options={(items()?.data ?? [])
            .toSorted((a, b) => b.created - a.created)
            .map((info) => ({
              title: Monitor.printable(info.command),
              value: info.id,
              description: info.status,
              footer: `${info.attempts} checks · ${info.probe ? `${info.probe.type} probe` : info.options.mode}`,
              onSelect: () => {
                setResult(false)
                setSelected(info.id)
              },
            }))}
        />
      }
    >
      {(info) => (
        <DialogSelect
          title={Monitor.printable(`${info().status}: ${info().command}`)}
          locked={busy()}
          options={[
            {
              title: "View last result",
              value: "result",
              description: `${info().attempts} checks · ${info().options.mode === "poll" ? Monitor.schedule(info().options) : info().workdir}`,
            },
            ...(info().status === "running"
              ? [
                  {
                    title: "Stop monitoring",
                    value: "cancel",
                    description: "Stops local observation. The external job keeps running.",
                  },
                ]
              : []),
            { title: "Back to monitors", value: "back" },
          ]}
          onSelect={(option) => {
            if (option.value === "back") return setSelected(undefined)
            if (option.value === "result") return setResult(true)
            void cancel(info())
          }}
          footer={
            <Show when={result()}>
              <scrollbox height={12} paddingLeft={2} paddingRight={2}>
                <text fg={theme.text.muted} wrapMode="word">
                  {Monitor.printable(
                    [
                      info().error,
                      info().evidence?.matched ? `Matched: ${info().evidence?.matched}` : undefined,
                      info().evidence?.output ?? "No result yet.",
                      info().evidence?.outputPath ? `Full output: ${info().evidence?.outputPath}` : undefined,
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  )}
                </text>
              </scrollbox>
            </Show>
          }
        />
      )}
    </Show>
  )
}
