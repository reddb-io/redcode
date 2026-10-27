/** @jsxImportSource react */
import { useState, type ComponentProps } from "react"
import { TaskList } from "@reddb-io/design-system/app/TaskList"
import { Button } from "@reddb-io/design-system/base/Button"
import { DescriptionList } from "@reddb-io/design-system/base/DescriptionList"
import { CodeBlock } from "@reddb-io/design-system/base/CodeBlock"
import { Field } from "@reddb-io/design-system/base/Field"
import { Select } from "@reddb-io/design-system/base/Select"
import type { HarnessTask } from "@opencode/client/promise"
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
      <section aria-label={copy.nativeTasks} className="min-w-0 border-t border-elevation-raised-border pt-3">
        <h3 className="mb-2 mt-0 text-body font-medium">{copy.nativeTasks}</h3>
        <p className="m-0 text-caption text-ink-muted">{copy.nativeTasksNote}</p>
        {view.harnessLinksFailed && <p role="alert">{copy.nativeLinksFailed}</p>}
        {view.harnessLinksLoading && !view.harnessLinksFailed && <p role="status">{copy.nativeLoading}</p>}
        {!view.harnessLinksLoading && !view.harnessLinksFailed && !view.harnesses.length && <p>{copy.nativeNoLinks}</p>}
        {!!view.harnesses.length && (
          <Field label={copy.nativeHarness} className="my-3">
            {(control) => (
              <Select
                {...control}
                value={view.harnessID}
                disabled={!view.connected || view.harnessLinksFailed}
                options={[
                  { value: "", label: copy.nativeChoose },
                  ...view.harnesses.map((run) => ({ value: run.runID, label: `${run.driver} · ${run.runID}` })),
                ]}
                onValueChange={props.actions.inspectHarness}
              />
            )}
          </Field>
        )}
        {view.nativeFailed && <p role="alert">{copy.nativeUnavailable}</p>}
        {view.nativeLoading && !view.nativeFailed && <p role="status">{copy.nativeLoading}</p>}
        {view.native && (
          <>
            <DescriptionList
              className="my-3 [&_dd]:break-all"
              items={[
                { term: copy.nativeHarness, detail: view.native.run.id },
                { term: copy.nativeSession, detail: view.native.run.nativeID ?? copy.monitorStateUnknown },
                { term: copy.monitorStatus, detail: copy[`external.${view.native.run.state}`] },
              ]}
            />
            {view.native.tasks === undefined ? (
              <p>{copy.nativeUnsupported}</p>
            ) : (
              <NativeTaskList key={view.harnessID} tasks={view.native.tasks} copy={copy} />
            )}
          </>
        )}
      </section>
    </div>
  )
}

function NativeTaskList(props: { tasks: readonly HarnessTask[]; copy: Record<string, string> }) {
  const [selected, setSelected] = useState("")
  const task = props.tasks.find((item) => item.id === selected)
  const copy = props.copy
  return (
    <>
      <TaskList
        label={copy.nativeTasks}
        emptyLabel={copy.nativeEmpty}
        items={props.tasks.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.status === "unknown" ? "paused" : item.status,
          stateLabel: copy[`nativeStatus.${item.status}`],
          description: copy[`nativeKind.${item.kind}`],
        }))}
        actions={(item) => (
          <Button size="sm" variant="ghost" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
            {copy.nativeInspect}
          </Button>
        )}
      />
      {task && (
        <section
          aria-label={copy.nativeDetails}
          className="mt-3 min-w-0 rounded-lg border border-elevation-raised-border p-3"
        >
          <h4 className="m-0 break-words text-body font-medium">{task.title}</h4>
          <DescriptionList
            className="my-3 [&_dd]:break-all"
            items={[
              { term: copy.nativeIdentity, detail: task.id },
              { term: copy.monitorStatus, detail: copy[`nativeStatus.${task.status}`] },
              { term: copy.nativeKind, detail: copy[`nativeKind.${task.kind}`] },
              ...(task.wait
                ? [
                    { term: copy.nativeWait, detail: copy[`nativeWait.${task.wait.state}`] },
                    {
                      term: copy.nativeWaitDeadline,
                      detail: new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
                        task.wait.deadlineAt,
                      ),
                    },
                  ]
                : []),
              ...(task.nativeType ? [{ term: copy.nativeType, detail: task.nativeType }] : []),
              ...(task.parentTaskID ? [{ term: copy.nativeParent, detail: task.parentTaskID }] : []),
              ...(task.toolUseID ? [{ term: copy.nativeTool, detail: task.toolUseID }] : []),
              ...(task.processID ? [{ term: copy.nativeProcess, detail: task.processID }] : []),
              ...(task.outputFile ? [{ term: copy.nativeFile, detail: task.outputFile }] : []),
              {
                term: copy.nativeUpdated,
                detail: new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
                  task.updatedAt,
                ),
              },
            ]}
          />
          {task.status === "unknown" && <p className="text-caption text-ink-muted">{copy.nativeUnknownNote}</p>}
          {task.output ? (
            <CodeBlock
              code={task.output}
              regionLabel={copy.nativeOutput}
              copyLabel={copy.monitorCopy}
              copiedLabel={copy.monitorCopied}
              copyErrorLabel={copy.monitorCopyFailed}
            />
          ) : (
            <p className="text-caption text-ink-muted">{copy.nativeNoOutput}</p>
          )}
          {task.truncated && <p className="text-caption text-ink-muted">{copy.monitorTruncated}</p>}
        </section>
      )}
    </>
  )
}
