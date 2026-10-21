import type { WorkerBatch, WorkerEntry, WorkerStatus } from "@opencode/client/promise"
import { badge } from "@reddb-io/design-system/contracts/badge"
import { button } from "@reddb-io/design-system/contracts/button"
import { card } from "@reddb-io/design-system/contracts/card"
import { listRow } from "@reddb-io/design-system/contracts/list-row"
import { nodeBadge } from "@reddb-io/design-system/contracts/node-badge"
import { progress } from "@reddb-io/design-system/contracts/progress"
import { toggleButton } from "@reddb-io/design-system/contracts/toggle-button"
import { Icon } from "@opencode/ui/icon"
import { Key } from "@solid-primitives/keyed"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { workerTaskTone } from "./worker-task-inspector"

export function WorkerBatchOverview(props: {
  batch: WorkerBatch
  workers: readonly WorkerStatus[]
  mobile: boolean
  stale: boolean
  busy: boolean
  selected: string
  visible: (id: string) => boolean
  select: (id: string, opener: HTMLButtonElement) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ layout: "workers" })
  const tasks = createMemo(() => {
    const entries = new Map(props.batch.report?.tasks.map((entry) => [entry.id, entry]))
    return props.batch.manifest.tasks.map((task) => ({ task, entry: entries.get(task.id) }))
  })
  const filtered = createMemo(() => tasks().filter((item) => props.visible(item.task.id)))
  // Requested placement is not an assignment. Unassigned work has its own lane.
  const groups = createMemo(() =>
    [...new Set(filtered().map((item) => item.entry?.worker))]
      .map((worker) => ({
        id: worker ? `worker:${worker}` : "unassigned",
        worker,
        tasks: filtered().filter((item) => item.entry?.worker === worker),
      }))
      .toSorted((a, b) => Number(!a.worker) - Number(!b.worker)),
  )
  const completed = () => tasks().filter((item) => item.entry?.state === "succeeded").length
  const meter = progress({ tone: "neutral" })
  const lane = card({ padding: "none" })
  const stateLabel = (entry?: WorkerEntry) => {
    if (entry?.state === "unknown") return language.t("remoteWorkers.overview.unconfirmed")
    if (entry?.state === "waiting") return language.t("remoteWorkers.overview.needsInput")
    return entry ? language.t(`remoteWorkers.state.${entry.state}`) : language.t("remoteWorkers.details.unreported")
  }
  const taskRow = (item: () => ReturnType<typeof tasks>[number]) => {
    const row = () => listRow({ interactive: true, selected: props.selected === item().task.id })
    return (
      <article class="min-w-0">
        <button
          type="button"
          class={row().root({
            class:
              "min-h-[var(--reddb-spatial-target-min)] gap-3 py-[var(--reddb-spatial-inset-md)] last:border-b-0 focus-visible:outline-2 focus-visible:outline-focus",
          })}
          disabled={props.busy}
          aria-label={language.t("remoteWorkers.details.open")}
          aria-description={`${item().task.prompt} · ${stateLabel(item().entry)}`}
          aria-pressed={props.selected === item().task.id}
          onClick={(event) => props.select(item().task.id, event.currentTarget)}
        >
          <span class={row().text({ class: "flex-1 gap-2" })}>
            <span class="line-clamp-2 text-body font-medium [overflow-wrap:anywhere]">{item().task.prompt}</span>
            <span class="flex flex-wrap items-center gap-2 text-caption">
              <span class={badge({ tone: workerTaskTone(item().entry?.state), variant: "tinted" })}>
                {stateLabel(item().entry)}
              </span>
              <Show when={props.mobile || state.layout === "list"}>
                <span class="text-ink-muted [overflow-wrap:anywhere]">
                  {item().entry?.worker ?? language.t("remoteWorkers.details.notAssigned")}
                </span>
              </Show>
            </span>
          </span>
          <Icon name="chevron-right" size="small" class="shrink-0 text-ink-muted" />
        </button>
      </article>
    )
  }
  return (
    <section
      aria-label={language.t("remoteWorkers.overview.title", { batch: props.batch.id })}
      class="flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-md)]"
    >
      <div class={meter.root()}>
        <div class={meter.summary()}>
          <span class={meter.label()}>{language.t("remoteWorkers.overview.progress")}</span>
          <span class={meter.value({ class: "tabular-nums" })}>
            {language.t("remoteWorkers.overview.completed", { completed: completed(), total: tasks().length })}
          </span>
        </div>
        <div
          class={meter.track()}
          role="progressbar"
          aria-label={language.t("remoteWorkers.overview.progress")}
          aria-valuenow={completed()}
          aria-valuemin={0}
          aria-valuemax={tasks().length}
        >
          <div class={meter.indicator()} style={{ width: `${(completed() / tasks().length) * 100}%` }} />
        </div>
      </div>
      <Show when={props.stale}>
        <p role="status" class="text-body text-feedback-warning">
          {language.t("remoteWorkers.overview.stale")}
        </p>
      </Show>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h5 class="text-body font-medium">{language.t("remoteWorkers.overview.assignments")}</h5>
        <Show when={!props.mobile}>
          <div role="group" aria-label={language.t("remoteWorkers.overview.layout")} class="flex gap-1">
            <button
              type="button"
              class={button({
                variant: "ghost",
                size: "sm",
                class: toggleButton({ pressed: state.layout === "workers" }),
              })}
              aria-pressed={state.layout === "workers"}
              onClick={() => setState("layout", "workers")}
            >
              {language.t("remoteWorkers.overview.byWorker")}
            </button>
            <button
              type="button"
              class={button({
                variant: "ghost",
                size: "sm",
                class: toggleButton({ pressed: state.layout === "list" }),
              })}
              aria-pressed={state.layout === "list"}
              onClick={() => setState("layout", "list")}
            >
              {language.t("remoteWorkers.overview.list")}
            </button>
          </div>
        </Show>
      </div>
      <Show when={filtered().length !== tasks().length}>
        <p class="text-caption text-ink-muted">
          {language.plural("remoteWorkers.overview.filtered", tasks().length, {
            count: filtered().length,
            total: tasks().length,
          })}
        </p>
      </Show>
      <Show
        when={!props.mobile && state.layout === "workers"}
        fallback={
          <div class={lane.root()}>
            <Key each={filtered()} by={(item) => item.task.id}>
              {taskRow}
            </Key>
          </div>
        }
      >
        <div class="grid items-start gap-[var(--reddb-spatial-gap-lg)] grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
          <Key each={groups()} by="id">
            {(group) => {
              const registered = () => props.workers.find((worker) => worker.worker.id === group().worker)
              const connection = () =>
                props.stale
                  ? "unknown"
                  : registered()?.connection === "online"
                    ? "online"
                    : registered()?.connection === "offline"
                      ? "offline"
                      : "unknown"
              const node = () =>
                nodeBadge({
                  status: connection(),
                })
              return (
                <section
                  aria-label={group().worker ?? language.t("remoteWorkers.details.notAssigned")}
                  class={lane.root()}
                >
                  <header
                    class={lane.header({
                      class: "flex flex-col items-start gap-2 p-[var(--reddb-spatial-inset-md)]",
                    })}
                  >
                    <div class="flex w-full flex-wrap items-baseline justify-between gap-2">
                      <h6 class="text-body font-medium [overflow-wrap:anywhere]">
                        {group().worker ?? language.t("remoteWorkers.details.notAssigned")}
                      </h6>
                      <span class="text-caption text-ink-muted tabular-nums">
                        {language.plural("remoteWorkers.overview.count", group().tasks.length, {
                          count: group().tasks.length,
                        })}
                      </span>
                    </div>
                    <Show when={group().worker}>
                      <span
                        class={node().root({
                          class: "max-w-full whitespace-normal rounded-none border-0 p-0 [overflow-wrap:anywhere]",
                        })}
                      >
                        <span aria-hidden="true" class={node().dot()} />
                        <span class={node().status()}>
                          {language.t(`remoteWorkers.overview.connection.${connection()}`)}
                        </span>
                      </span>
                    </Show>
                    <Show when={group().worker && !registered()}>
                      <span class="w-full text-caption text-ink-muted">
                        {language.t("remoteWorkers.overview.removedWorker")}
                      </span>
                    </Show>
                  </header>
                  <Key each={group().tasks} by={(item) => item.task.id}>
                    {taskRow}
                  </Key>
                </section>
              )
            }}
          </Key>
        </div>
      </Show>
    </section>
  )
}
