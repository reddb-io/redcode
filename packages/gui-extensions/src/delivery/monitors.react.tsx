/** @jsxImportSource react */
import { useState, type ComponentProps } from "react"
import { TaskList } from "@reddb-io/design-system/app/TaskList"
import { Button } from "@reddb-io/design-system/base/Button"
import { DescriptionList } from "@reddb-io/design-system/base/DescriptionList"
import { CodeBlock } from "@reddb-io/design-system/base/CodeBlock"
import type { DeliveryMonitors } from "./monitors"

export function DeliveryMonitorView(props: {
  view: ReturnType<DeliveryMonitors["snapshot"]>
  actions: DeliveryMonitors["actions"]
  copy: Record<string, string>
}) {
  const view = props.view
  const copy = props.copy
  const [selected, setSelected] = useState<string | null>(null)
  const monitor = view.items.find((item) => item.id === selected)
  const items: ComponentProps<typeof TaskList>["items"] = view.items.map((item) => ({
    id: item.id,
    title: item.command,
    state:
      item.status === "interrupted"
        ? "paused"
        : item.status === "expired" || item.status === "timed_out"
          ? "failed"
          : item.status,
    stateLabel: copy[`monitor.${item.status}`],
    description: item.workdir,
    reason: item.error,
  }))
  return (
    <div className="flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-md)]">
      <p className="m-0 text-caption text-ink-muted">{copy.monitorsNote}</p>
      {(!view.connected || view.unavailable) && (
        <p role="alert" className="m-0 text-caption text-feedback-warning-foreground">
          {view.connected ? copy.monitorsUnavailable : copy.monitorsDisconnected}
        </p>
      )}
      {view.loading && view.connected && !view.unavailable && <p role="status">{copy.monitorsLoading}</p>}
      {view.cancelFailed && <p role="alert">{copy.monitorCancelFailed}</p>}
      {!view.loading && (
        <TaskList
          label={copy.monitors}
          items={items}
          emptyLabel={view.unavailable || !view.connected ? copy.monitorStateUnknown : copy.noMonitors}
          actions={(item) => (
            <Button size="sm" variant="ghost" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
              {copy.inspectMonitor}
            </Button>
          )}
        />
      )}
      {selected && !monitor && !view.loading && (
        <p role="status" className="text-caption text-ink-muted">
          {copy.monitorRemoved}
        </p>
      )}
      {monitor && (
        <section
          aria-label={copy.monitorDetails}
          className="min-w-0 rounded-lg border border-elevation-raised-border p-3"
        >
          <h3 className="m-0 break-words text-body font-medium">{monitor.command}</h3>
          <DescriptionList
            className="my-3 min-w-0 [&_dd]:min-w-0 [&_dd]:break-all"
            items={[
              { term: copy.monitorIdentity, detail: monitor.id },
              { term: copy.monitorStatus, detail: copy[`monitor.${monitor.status}`] },
              { term: copy.monitorAttempts, detail: String(monitor.attempts) },
              { term: copy.monitorMode, detail: copy[`monitor.mode.${monitor.options.mode}`] },
              { term: copy.monitorDelivery, detail: copy[`monitor.delivery.${monitor.delivery}`] },
              ...(monitor.options.interval_ms === undefined
                ? []
                : [{ term: copy.monitorInterval, detail: String(monitor.options.interval_ms) }]),
              ...(monitor.options.deadline_ms === undefined
                ? []
                : [{ term: copy.monitorDeadline, detail: String(monitor.options.deadline_ms) }]),
              ...(monitor.evidence?.exit == null
                ? []
                : [{ term: copy.monitorExit, detail: String(monitor.evidence.exit) }]),
              ...(monitor.cleanup
                ? [{ term: copy.monitorCleanup, detail: copy[`monitor.cleanup.${monitor.cleanup}`] }]
                : []),
            ]}
          />
          <h4 className="mb-2 mt-0 text-eyebrow text-ink-muted">{copy.monitorEvidence}</h4>
          {monitor.evidence ? (
            <>
              <CodeBlock
                code={monitor.evidence.output}
                regionLabel={copy.monitorEvidence}
                copyLabel={copy.monitorCopy}
                copiedLabel={copy.monitorCopied}
                copyErrorLabel={copy.monitorCopyFailed}
              />
              {monitor.evidence.matched && <p className="text-caption">{monitor.evidence.matched}</p>}
              {monitor.evidence.error && (
                <p className="text-caption text-feedback-warning-foreground">{monitor.evidence.error}</p>
              )}
              {monitor.evidence.truncated && <p className="text-caption text-ink-muted">{copy.monitorTruncated}</p>}
            </>
          ) : (
            <p className="text-caption text-ink-muted">{copy.monitorNoEvidence}</p>
          )}
          {monitor.status === "running" && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="m-0 text-caption text-ink-muted">{copy.monitorStopNote}</p>
              <Button
                variant="secondary"
                disabled={!view.connected || view.unavailable || view.cancelling}
                onClick={() => props.actions.cancel(monitor.id)}
              >
                {copy.monitorStop}
              </Button>
            </div>
          )}
          {monitor.status !== "running" && <p className="mb-0 text-caption text-ink-muted">{copy.monitorStopNote}</p>}
        </section>
      )}
    </div>
  )
}
