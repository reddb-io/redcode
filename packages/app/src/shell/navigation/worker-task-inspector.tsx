import type { WorkerBatch, WorkerTask, WorkerEntry } from "@opencode/client/promise"
import { sidebarPanel } from "@reddb-io/design-system/contracts/sidebar-panel"
import { statusIndicator } from "@reddb-io/design-system/contracts/status-indicator"
import { Button } from "@opencode/ui/button"
import { createEffect, createMemo, on, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

export function WorkerTaskStatus(props: { entry?: WorkerEntry }) {
  const language = useLanguage()
  const appearance = () =>
    statusIndicator({
      tone:
        props.entry?.state === "succeeded"
          ? "success"
          : props.entry?.state === "failed"
            ? "danger"
            : ["unknown", "waiting", "interrupted"].includes(props.entry?.state ?? "")
              ? "warning"
              : ["running", "dispatching"].includes(props.entry?.state ?? "")
                ? "info"
                : "neutral",
    })
  return (
    <p class={appearance().root()}>
      <span aria-hidden="true" class={appearance().mark()} />
      <span>
        {props.entry
          ? language.t(`remoteWorkers.state.${props.entry.state}`)
          : language.t("remoteWorkers.details.unreported")}
        <Show when={props.entry?.worker}> · {props.entry?.worker}</Show>
      </span>
    </p>
  )
}

export function WorkerTaskInspector(props: {
  id: string
  selection?: { batch: WorkerBatch; task: WorkerTask; entry?: WorkerEntry }
  busy: boolean
  stale: boolean
  error: string
  refreshing: boolean
  refresh: () => void
  back: () => void
  controls: JSX.Element
}) {
  const language = useLanguage()
  const panel = sidebarPanel()
  const identity = createMemo(() => `${props.selection?.batch.id ?? ""}/${props.id}`)
  let element: HTMLElement | undefined
  let body: HTMLDivElement | undefined
  createEffect(
    on(identity, () =>
      queueMicrotask(() => {
        if (!element?.isConnected) return
        if (body) body.scrollTop = 0
        element.focus({ preventScroll: true })
        element.scrollIntoView({ block: "nearest" })
      }),
    ),
  )
  return (
    <section
      ref={element}
      tabIndex={-1}
      aria-label={language.t("remoteWorkers.details.title")}
      class={panel.root({
        class:
          "max-h-[calc(var(--agents-content-height,100dvh)-3rem)] overflow-hidden rounded-lg border border-muted focus-visible:outline-2 focus-visible:outline-focus",
      })}
    >
      <header class={panel.toolbar()}>
        <div class="min-w-0">
          <h3 class="text-body font-medium">{language.t("remoteWorkers.details.title")}</h3>
          <p class="text-caption text-ink-muted [overflow-wrap:anywhere]">{props.id}</p>
        </div>
        <Button variant="ghost" disabled={props.busy} onClick={props.back}>
          {language.t("remoteWorkers.backToTasks")}
        </Button>
      </header>
      <div
        ref={body}
        class={panel.body({
          class: "flex flex-col gap-3 overflow-y-auto overscroll-contain pt-[var(--reddb-spatial-inset-sm)]",
        })}
      >
        <Show when={props.stale}>
          <p role="alert">{language.t("remoteWorkers.details.stale")}</p>
          <Button variant="outline" disabled={props.refreshing} onClick={props.refresh}>
            {language.t("common.retry")}
          </Button>
        </Show>
        <Show when={props.selection} fallback={<p role="alert">{language.t("remoteWorkers.details.missing")}</p>}>
          {(selection) => (
            <>
              <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{selection().task.prompt}</p>
              <WorkerTaskStatus entry={selection().entry} />
              <Show when={selection().entry?.state === "waiting"}>
                <p>{language.t("remoteWorkers.waiting")}</p>
              </Show>
              <Show when={selection().entry?.queueReason}>
                {(reason) => <p role="status">{language.t(`remoteWorkers.queue.${reason()}`)}</p>}
              </Show>
              <Show when={selection().entry?.recoveryReason}>
                {(reason) => <p role="status">{language.t(`remoteWorkers.recoveryReason.${reason()}`)}</p>}
              </Show>
              <Show when={selection().entry?.detail}>
                {(detail) => <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{detail()}</p>}
              </Show>
              <dl class="grid gap-[var(--reddb-spatial-gap-md)] text-body [overflow-wrap:anywhere]">
                <div>
                  <dt class="font-medium">{language.t("remoteWorkers.details.batch")}</dt>
                  <dd class="text-ink-muted">{selection().batch.id}</dd>
                </div>
                <div>
                  <dt class="font-medium">{language.t("remoteWorkers.details.created")}</dt>
                  <dd class="text-ink-muted">
                    <time dateTime={selection().batch.createdAt}>{selection().batch.createdAt}</time>
                  </dd>
                </div>
                <div>
                  <dt class="font-medium">{language.t("remoteWorkers.details.requestedWorker")}</dt>
                  <dd class="text-ink-muted">{selection().task.worker ?? language.t("remoteWorkers.any")}</dd>
                </div>
                <div>
                  <dt class="font-medium">{language.t("remoteWorkers.details.assignedWorker")}</dt>
                  <dd class="text-ink-muted">
                    {selection().entry?.worker ?? language.t("remoteWorkers.details.notAssigned")}
                  </dd>
                </div>
                <div>
                  <dt class="font-medium">{language.t("remoteWorkers.details.directory")}</dt>
                  <dd class="text-ink-muted">
                    {selection().entry?.directory ?? language.t("remoteWorkers.details.unreported")}
                  </dd>
                </div>
                <Show when={selection().task.tags?.length}>
                  <div>
                    <dt class="font-medium">{language.t("remoteWorkers.taskTags")}</dt>
                    <dd class="text-ink-muted">{selection().task.tags?.join(", ")}</dd>
                  </div>
                </Show>
                <Show when={selection().task.resources}>
                  {(resources) => (
                    <div>
                      <dt class="font-medium">{language.t("remoteWorkers.details.resources")}</dt>
                      <dd class="text-ink-muted">
                        {language.t("remoteWorkers.resources.summary", {
                          cpu: resources().cpu,
                          memory: (resources().memoryBytes / 1024 ** 3).toFixed(2),
                        })}
                        <Show when={resources().maxCpuUtilization}>
                          {(limit) => (
                            <p>
                              {language.t("remoteWorkers.resources.loadSummary", { value: Math.round(limit() * 100) })}
                            </p>
                          )}
                        </Show>
                      </dd>
                    </div>
                  )}
                </Show>
                <Show when={selection().task.model}>
                  {(model) => (
                    <div>
                      <dt class="font-medium">{language.t("remoteWorkers.details.requestedModel")}</dt>
                      <dd class="text-ink-muted">
                        {model().providerID}/{model().id}
                      </dd>
                    </div>
                  )}
                </Show>
                <Show when={selection().entry?.lease}>
                  {(lease) => (
                    <div>
                      <dt class="font-medium">{language.t("remoteWorkers.details.lease")}</dt>
                      <dd class="text-ink-muted">
                        {selection().entry?.leaseReleased
                          ? language.t("remoteWorkers.lease.released")
                          : language.t("remoteWorkers.lease.held", { generation: lease().generation })}
                      </dd>
                    </div>
                  )}
                </Show>
              </dl>
              <details>
                <summary class="min-h-[var(--reddb-spatial-target-min)] cursor-pointer py-[var(--reddb-spatial-gap-sm)]">
                  {language.t("remoteWorkers.details.identifiers")}
                </summary>
                <dl class="grid gap-2 text-mono [overflow-wrap:anywhere]">
                  <div>
                    <dt>{language.t("remoteWorkers.details.session")}</dt>
                    <dd>{selection().entry?.sessionID ?? language.t("remoteWorkers.details.unreported")}</dd>
                  </div>
                  <div>
                    <dt>{language.t("remoteWorkers.details.message")}</dt>
                    <dd>{selection().entry?.messageID ?? language.t("remoteWorkers.details.unreported")}</dd>
                  </div>
                </dl>
              </details>
              <Show when={selection().entry?.text}>
                <details>
                  <summary class="min-h-[var(--reddb-spatial-target-min)] cursor-pointer py-[var(--reddb-spatial-gap-sm)]">
                    {language.t("remoteWorkers.response")}
                  </summary>
                  <pre class="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">{selection().entry?.text}</pre>
                </details>
              </Show>
              <p class="text-caption text-ink-muted">{language.t("remoteWorkers.details.evidence")}</p>
            </>
          )}
        </Show>
      </div>
      <footer
        class={panel.footer({ class: "max-h-[50dvh] overflow-y-auto overscroll-contain bg-elevation-raised-surface" })}
      >
        <Show when={props.error}>
          <p role="alert" class="max-h-24 overflow-auto [overflow-wrap:anywhere]">
            {props.error}
          </p>
        </Show>
        {props.controls}
      </footer>
    </section>
  )
}
