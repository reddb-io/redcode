import { Worker } from "@opencode/schema/worker"
import { Schema } from "effect"
import { button } from "@reddb-io/design-system/contracts/button"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { SearchSelect } from "@opencode/ui/search-select"
import { Key } from "@solid-primitives/keyed"
import { useQuery } from "@tanstack/solid-query"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { uuid } from "@/runtime/persistence/uuid"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { useNavigation } from "./controller"
import { AgentChangeReview } from "./agent-change-review"

export function RemoteWorkers(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const navigation = useNavigation()
  let reviewOpener: HTMLButtonElement | undefined
  let addButton: HTMLButtonElement | undefined
  let addForm: HTMLFormElement | undefined
  const global = useGlobal()
  const api = () => global.ensureServerCtx(props.server).sdk.api.workers
  const [state, setState] = createStore({
    adding: false,
    id: "",
    url: "",
    directory: "",
    password: "",
    resourceID: "",
    tags: "",
    prompt: "",
    target: "",
    taskTags: "",
    requirements: false,
    cpu: "1",
    memory: "1",
    maxCpu: "",
    instruction: { key: "", id: "", text: "", delivery: "steer" as "steer" | "queue" },
    drafts: [] as Worker.Task[],
    busy: false,
    error: "",
    removing: "",
    artifact: undefined as Worker.Artifact | undefined,
    artifactPrompt: "",
  })
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  const query = useQuery(() => ({
    queryKey: ["remote-workers", ServerConnection.key(props.server)],
    enabled: global.ensureServerCtx(props.server).sdk.connection.status() === "connected",
    queryFn: ({ signal }) => api().list({ signal }),
    retry: false,
    refetchInterval: 3000,
  }))
  const active = () =>
    query.data?.batches.some(
      (batch) =>
        !batch.report ||
        batch.report.tasks.some((task) => !["succeeded", "failed", "interrupted"].includes(task.state)),
    )
  const appearance = card({ padding: "md" })
  const form = appearance.root({ class: "overflow-visible" })
  const revealField = (event: FocusEvent & { currentTarget: HTMLFormElement }) => {
    if (!navigation.mobile()) return
    const field = event.target
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return
    if (!event.currentTarget.contains(field)) return
    // Native focus scrolling does not account for the pinned form actions.
    field.scrollIntoView({ block: "center", inline: "nearest" })
  }
  const missingWorker = (id: string) => !!id && !query.data?.workers.some((status) => status.worker.id === id)
  const unavailable = () =>
    !query.data?.workers.length ||
    state.drafts.some((task) => task.worker && missingWorker(task.worker)) ||
    (!!state.prompt.trim() && missingWorker(state.target))
  const closeAdd = () => {
    setState({ adding: false, password: "" })
    queueMicrotask(() => {
      addButton?.focus({ preventScroll: true })
      addButton?.scrollIntoView({ block: "nearest" })
    })
  }
  const secondary = button({ variant: "secondary", size: "sm" })
  const draft = (): Worker.Task => ({
    id: `task-${uuid()}`,
    prompt: state.prompt.trim(),
    ...(state.target ? { worker: state.target } : {}),
    ...(state.taskTags.trim()
      ? {
          tags: state.taskTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }
      : {}),
    ...(state.requirements
      ? {
          resources: {
            cpu: Number(state.cpu),
            memoryBytes: Math.round(Number(state.memory) * 1024 ** 3),
            ...(state.maxCpu ? { maxCpuUtilization: Number(state.maxCpu) / 100 } : {}),
          },
        }
      : {}),
  })
  const action = (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    void run()
      .then(() => {
        if (lifetime.active) void query.refetch()
      })
      .catch((error) => {
        if (lifetime.active) setState("error", errorMessage(error, language.t("remoteWorkers.failed")))
      })
      .finally(() => {
        if (lifetime.active) setState("busy", false)
      })
  }
  const back = () => {
    setState("artifact", undefined)
    queueMicrotask(() => {
      if (!reviewOpener?.isConnected) return
      reviewOpener.focus({ preventScroll: true })
      reviewOpener.scrollIntoView({ block: "nearest" })
    })
  }
  return (
    <div class="flex min-w-0 flex-col gap-4 text-sm leading-5">
      <Show when={state.artifact}>
        {(artifact) => (
          <AgentChangeReview
            title={language.t("remoteWorkers.changes")}
            back={language.t("remoteWorkers.backToTasks")}
            close={back}
            busy={state.busy}
            error={state.error}
            footer={
              <div class="flex flex-wrap gap-2">
                <button
                  class={secondary}
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([artifact().patch], { type: "text/plain" }))
                    const link = document.createElement("a")
                    link.href = url
                    link.download = `${artifact().task.id}.patch`
                    link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                  }}
                >
                  {language.t("remoteWorkers.download")}
                </button>
              </div>
            }
          >
            <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{state.artifactPrompt}</p>
            <p class="text-ink-muted [overflow-wrap:anywhere]">
              {language.t("remoteWorkers.reviewSource", {
                task: artifact().task.id,
                worker: artifact().task.worker ?? language.t("common.unknown"),
              })}
            </p>
            <p class="text-ink-muted">{language.t("remoteWorkers.reviewDescription")}</p>
            <Key each={artifact().files} by="file">
              {(file) => (
                <details class="min-w-0 rounded border border-muted">
                  <summary class="cursor-pointer p-3 [overflow-wrap:anywhere]">
                    {file().file} (+{file().additions} / −{file().deletions})
                  </summary>
                  <pre
                    tabIndex={0}
                    aria-label={file().file}
                    class="max-h-80 overflow-auto overscroll-contain whitespace-pre p-3 text-mono"
                  >
                    {file().patch}
                  </pre>
                </details>
              )}
            </Key>
            <Show when={!artifact().files.length}>
              <p>{language.t("remoteWorkers.noChanges")}</p>
            </Show>
          </AgentChangeReview>
        )}
      </Show>
      <div hidden={!!state.artifact && navigation.mobile()} class="min-w-0 flex flex-col gap-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-medium">{language.t("remoteWorkers.title")}</h3>
            <p class="text-ink-muted">{language.t("remoteWorkers.description")}</p>
          </div>
          <button
            class={secondary}
            disabled={state.busy || active() || !query.data?.available}
            ref={addButton}
            onClick={() => {
              if (state.adding) return closeAdd()
              setState("adding", true)
              queueMicrotask(() => {
                addForm?.focus({ preventScroll: true })
                addForm?.scrollIntoView({ block: "nearest" })
              })
            }}
          >
            {language.t("remoteWorkers.add")}
          </button>
        </header>
        <Show when={query.isPending}>
          <p role="status">{language.t("remoteWorkers.loading")}</p>
        </Show>
        <Show when={query.isError || query.data?.available === false}>
          <p role="alert" class="text-feedback-warning">
            {language.t("remoteWorkers.unavailable")}
          </p>
          <button class={secondary} onClick={() => void query.refetch()}>
            {language.t("common.retry")}
          </button>
        </Show>
        <Show when={state.error && !state.artifact}>
          <p role="alert" class="text-feedback-danger">
            {state.error}
          </p>
        </Show>
        <Show when={state.adding}>
          <form
            class={form}
            onFocusIn={revealField}
            ref={addForm}
            tabIndex={-1}
            aria-label={language.t("remoteWorkers.connectTitle")}
            onSubmit={(event) => {
              event.preventDefault()
              action(async () => {
                await api().add({
                  id: state.id.trim(),
                  url: state.url.trim(),
                  directories: [state.directory.trim()],
                  password: state.password,
                  ...(state.resourceID.trim() ? { resourceID: state.resourceID.trim() } : {}),
                  tags: state.tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
                if (lifetime.active)
                  setState({ adding: false, id: "", url: "", directory: "", password: "", tags: "", resourceID: "" })
              })
            }}
          >
            <div class={appearance.header()}>
              <h3 class={appearance.title()}>{language.t("remoteWorkers.connectTitle")}</h3>
            </div>
            <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2 space-y-0" })}>
              <label>
                {language.t("remoteWorkers.name")}
                <input
                  class={input()}
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  value={state.id}
                  onInput={(event) => setState("id", event.currentTarget.value)}
                />
              </label>
              <label>
                {language.t("remoteWorkers.address")}
                <input
                  class={input()}
                  type="url"
                  required
                  placeholder="http://192.168.1.50:4096"
                  value={state.url}
                  onInput={(event) => setState("url", event.currentTarget.value)}
                />
              </label>
              <label>
                {language.t("remoteWorkers.directory")}
                <input
                  class={input()}
                  required
                  value={state.directory}
                  onInput={(event) => setState("directory", event.currentTarget.value)}
                />
              </label>
              <label>
                {language.t("remoteWorkers.password")}
                <input
                  class={input()}
                  type="password"
                  required
                  autocomplete="off"
                  value={state.password}
                  onInput={(event) => setState("password", event.currentTarget.value)}
                />
              </label>
              <details class="sm:col-span-2">
                <summary class="min-h-[var(--reddb-spatial-target-min)] cursor-pointer py-[var(--reddb-spatial-gap-sm)]">
                  {language.t("remoteWorkers.advanced")}
                </summary>
                <div class="grid gap-3 pt-2 sm:grid-cols-2">
                  <label class="flex flex-col gap-1">
                    {language.t("remoteWorkers.resourceID")}
                    <input
                      class={input()}
                      value={state.resourceID}
                      onInput={(event) => setState("resourceID", event.currentTarget.value)}
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    {language.t("remoteWorkers.tags")}
                    <input
                      class={input()}
                      value={state.tags}
                      onInput={(event) => setState("tags", event.currentTarget.value)}
                    />
                  </label>
                </div>
              </details>
              <p class="sm:col-span-2 text-ink-muted">{language.t("remoteWorkers.credentials")}</p>
            </div>
            <div class={appearance.footer({ class: "sticky bottom-0 z-10 rounded-b-lg bg-elevation-raised-surface" })}>
              <button class={button({ variant: "primary", size: "sm" })} type="submit" disabled={state.busy}>
                {language.t("remoteWorkers.connect")}
              </button>
              <button class={secondary} type="button" disabled={state.busy} onClick={closeAdd}>
                {language.t("common.cancel")}
              </button>
            </div>
          </form>
        </Show>
        <Show when={query.data?.available && !query.data.workers.length}>
          <p class="text-ink-muted">{language.t("remoteWorkers.empty")}</p>
        </Show>
        <Show when={query.data?.available && (query.data.workers.length || state.drafts.length || state.prompt.trim())}>
          <form
            class={form}
            onFocusIn={revealField}
            aria-label={language.t("remoteWorkers.compose")}
            onSubmit={(event) => {
              event.preventDefault()
              action(async () => {
                if (unavailable()) return
                await api().submit({ tasks: [...state.drafts, ...(state.prompt.trim() ? [draft()] : [])] })
                if (lifetime.active) setState({ prompt: "", drafts: [] })
              })
            }}
          >
            <div class={appearance.header()}>
              <h3 class={appearance.title()}>{language.t("remoteWorkers.compose")}</h3>
            </div>
            <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
              <label>
                {language.t("remoteWorkers.task")}
                <textarea
                  class={textarea()}
                  rows={3}
                  required={!state.drafts.length}
                  disabled={state.busy || active()}
                  value={state.prompt}
                  onInput={(event) => setState("prompt", event.currentTarget.value)}
                />
              </label>
              <label>
                {language.t("remoteWorkers.target")}
                <SearchSelect
                  label={language.t("remoteWorkers.target")}
                  value={state.target}
                  disabled={state.busy || active()}
                  onChange={(value) => setState("target", value)}
                  options={[
                    { value: "", label: language.t("remoteWorkers.any") },
                    ...(query.data?.workers ?? []).map((status) => ({
                      value: status.worker.id,
                      label: status.worker.id,
                      description: language.t("remoteWorkers.workerOption", {
                        connection: language.t(`remoteWorkers.connection.${status.connection}`),
                        directory: status.worker.directories.join(" · "),
                      }),
                      keywords: [status.worker.url, ...status.worker.tags],
                    })),
                  ]}
                />
              </label>
              <Show when={active()}>
                <p class="text-ink-muted">{language.t("remoteWorkers.active")}</p>
              </Show>
              <label>
                {language.t("remoteWorkers.taskTags")}
                <input
                  class={input()}
                  disabled={state.busy || active()}
                  value={state.taskTags}
                  onInput={(event) => setState("taskTags", event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                class={secondary}
                aria-pressed={state.requirements}
                disabled={state.busy || active()}
                onClick={() => setState("requirements", !state.requirements)}
              >
                {language.t("remoteWorkers.resources.toggle")}
              </button>
              <Show when={state.requirements}>
                <fieldset class="grid gap-3 sm:grid-cols-3" disabled={state.busy || active()}>
                  <legend class="mb-2">{language.t("remoteWorkers.resources.title")}</legend>
                  <label>
                    {language.t("remoteWorkers.resources.cpu")}
                    <input
                      class={input()}
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={state.cpu}
                      onInput={(event) => setState("cpu", event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    {language.t("remoteWorkers.resources.memory")}
                    <input
                      class={input()}
                      type="number"
                      min="0.25"
                      max="8388607"
                      step="0.25"
                      required
                      value={state.memory}
                      onInput={(event) => setState("memory", event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    {language.t("remoteWorkers.resources.load")}
                    <input
                      class={input()}
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={state.maxCpu}
                      onInput={(event) => setState("maxCpu", event.currentTarget.value)}
                    />
                  </label>
                  <p class="sm:col-span-3 text-ink-muted">{language.t("remoteWorkers.resources.note")}</p>
                </fieldset>
              </Show>
              <Show when={state.drafts.length}>
                <section aria-label={language.t("remoteWorkers.drafts")} class="flex min-w-0 flex-col gap-3">
                  <h4 class="font-medium">
                    {language.plural("remoteWorkers.draftCount", state.drafts.length, { count: state.drafts.length })}
                  </h4>
                  <For each={state.drafts}>
                    {(task) => (
                      <article
                        aria-label={task.prompt}
                        class="flex min-w-0 flex-col gap-2 rounded border border-muted p-[var(--reddb-spatial-inset-sm)]"
                      >
                        <header class="flex min-w-0 flex-wrap items-start gap-2">
                          <p class="min-w-0 flex-1 basis-32 whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {task.prompt}
                          </p>
                          <button
                            type="button"
                            class={secondary}
                            disabled={state.busy || active()}
                            aria-label={language.t("remoteWorkers.removeDraft", { prompt: task.prompt })}
                            onClick={() =>
                              setState(
                                "drafts",
                                state.drafts.filter((item) => item.id !== task.id),
                              )
                            }
                          >
                            {language.t("remoteWorkers.remove")}
                          </button>
                        </header>
                        <div class="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                          <p class="text-ink-muted">
                            {language.t("remoteWorkers.draftTarget", {
                              worker: task.worker || language.t("remoteWorkers.any"),
                            })}
                          </p>
                          <Show when={task.worker}>
                            {(worker) => (
                              <Show when={missingWorker(worker())}>
                                <p role="status">
                                  {language.t("remoteWorkers.draftWorkerMissing", { worker: worker() })}
                                </p>
                              </Show>
                            )}
                          </Show>
                          <Show when={task.tags?.join(", ")}>
                            {(tags) => (
                              <p class="text-ink-muted">{language.t("remoteWorkers.draftTags", { tags: tags() })}</p>
                            )}
                          </Show>
                          <Show when={task.resources}>
                            {(resources) => (
                              <>
                                <p class="text-ink-muted">
                                  {language.t("remoteWorkers.resources.summary", {
                                    cpu: resources().cpu,
                                    memory: (resources().memoryBytes / 1024 ** 3).toFixed(2),
                                  })}
                                </p>
                                <Show when={resources().maxCpuUtilization}>
                                  {(limit) => (
                                    <p class="text-ink-muted">
                                      {language.t("remoteWorkers.resources.loadSummary", {
                                        value: Math.round(limit() * 100),
                                      })}
                                    </p>
                                  )}
                                </Show>
                              </>
                            )}
                          </Show>
                        </div>
                      </article>
                    )}
                  </For>
                </section>
              </Show>
            </div>
            <div class={appearance.footer({ class: "sticky bottom-0 z-10 rounded-b-lg bg-elevation-raised-surface" })}>
              <Show when={!query.data?.workers.length}>
                <p role="status" class="basis-full">
                  {language.t("remoteWorkers.empty")}
                </p>
              </Show>
              <Show when={state.prompt.trim() && missingWorker(state.target)}>
                <p role="status" class="basis-full [overflow-wrap:anywhere]">
                  {language.t("remoteWorkers.targetMissing", { worker: state.target })}
                </p>
              </Show>
              <button
                type="button"
                class={secondary}
                disabled={
                  state.busy ||
                  active() ||
                  !query.data?.workers.length ||
                  !state.prompt.trim() ||
                  missingWorker(state.target)
                }
                onClick={(event) => {
                  if (!event.currentTarget.closest("form")?.reportValidity()) return
                  setState("drafts", [...state.drafts, draft()])
                  setState("prompt", "")
                }}
              >
                {language.t("remoteWorkers.addTask")}
              </button>
              <button
                type="submit"
                class={button({ variant: "primary", size: "sm" })}
                disabled={state.busy || active() || unavailable() || (!state.prompt.trim() && !state.drafts.length)}
              >
                {language.t("remoteWorkers.dispatch")}
              </button>
            </div>
          </form>
        </Show>
        <Key each={query.data?.workers} by={(status) => status.worker.id}>
          {(status) => (
            <article class={appearance.root()}>
              <div class={`${appearance.body()} flex flex-wrap items-center justify-between gap-3`}>
                <div>
                  <h4 class="font-medium">
                    {status().worker.id} · {language.t(`remoteWorkers.connection.${status().connection}`)}
                  </h4>
                  <p class="break-all text-ink-muted">{status().worker.url}</p>
                  <p class="break-all">{status().worker.directories.join(" · ")}</p>
                  <Show when={status().platform}>
                    <p class="text-ink-muted">
                      {status().platform} · {status().worker.tags.join(", ")}
                    </p>
                  </Show>
                </div>
                <div class="flex gap-2">
                  <button
                    class={secondary}
                    disabled={state.busy}
                    onClick={() => action(() => api().probe({ id: status().worker.id }))}
                  >
                    {language.t("remoteWorkers.probe")}
                  </button>
                  <button
                    class={button({ variant: "ghost", tone: "danger", size: "sm" })}
                    disabled={state.busy || active()}
                    onClick={() => setState("removing", status().worker.id)}
                  >
                    {language.t("remoteWorkers.remove")}
                  </button>
                </div>
              </div>
              <Show when={state.removing === status().worker.id}>
                <div class={appearance.footer()}>
                  <p>{language.t("remoteWorkers.confirmRemove", { worker: status().worker.id })}</p>
                  <button
                    class={secondary}
                    disabled={state.busy}
                    onClick={() =>
                      action(async () => {
                        await api().remove({ id: status().worker.id })
                        if (lifetime.active) setState("removing", "")
                      })
                    }
                  >
                    {language.t("agents.confirm")}
                  </button>
                  <button class={secondary} onClick={() => setState("removing", "")}>
                    {language.t("common.cancel")}
                  </button>
                </div>
              </Show>
            </article>
          )}
        </Key>
        <Key each={query.data?.batches} by={(batch) => batch.id}>
          {(batch) => (
            <section class={appearance.root()}>
              <div class={appearance.header()}>
                <h4 class={appearance.title()}>{language.t("remoteWorkers.batch")}</h4>
                <p class={appearance.description()}>{batch().createdAt}</p>
              </div>
              <div class={`${appearance.body()} flex flex-col gap-3`}>
                <Show when={batch().error}>
                  <p role="status" class="text-feedback-warning">
                    {batch().error}
                  </p>
                </Show>
                <Key each={batch().manifest.tasks} by={(task) => task.id}>
                  {(task) => {
                    const entry = () => batch().report?.tasks.find((item) => item.id === task().id)
                    return (
                      <article class="flex flex-col gap-2 border-b border-muted pb-3 last:border-b-0">
                        <p class="whitespace-pre-wrap">{task().prompt}</p>
                        <p class="text-ink-muted">
                          {language.t(`remoteWorkers.state.${entry()?.state ?? "queued"}`)}
                          <Show when={entry()?.worker}> · {entry()?.worker}</Show>
                        </p>
                        <Show when={entry()?.state === "waiting"}>
                          <p>{language.t("remoteWorkers.waiting")}</p>
                        </Show>
                        <Show when={entry()?.recoveryReason}>
                          {(reason) => (
                            <p role="status" class="text-ink-muted">
                              {language.t(`remoteWorkers.recoveryReason.${reason()}`)}
                            </p>
                          )}
                        </Show>
                        <Show when={entry()?.lease}>
                          {(lease) => (
                            <p class="text-ink-muted">
                              {entry()?.leaseReleased
                                ? language.t("remoteWorkers.lease.released")
                                : language.t("remoteWorkers.lease.held", { generation: lease().generation })}
                            </p>
                          )}
                        </Show>
                        <Show when={task().resources} keyed>
                          {(resources) => (
                            <p class="text-ink-muted">
                              {language.t("remoteWorkers.resources.summary", {
                                cpu: resources.cpu,
                                memory: (resources.memoryBytes / 1024 ** 3).toFixed(2),
                              })}
                            </p>
                          )}
                        </Show>
                        <Show when={entry()?.queueReason}>
                          {(reason) => <p role="status">{language.t(`remoteWorkers.queue.${reason()}`)}</p>}
                        </Show>
                        <Show when={entry()?.state === "queued" && !entry()?.sessionID}>
                          <button
                            class={secondary}
                            disabled={state.busy}
                            onClick={() =>
                              action(() =>
                                api().control({ id: batch().id, payload: { kind: "cancel", task: task().id } }),
                              )
                            }
                          >
                            {language.t("remoteWorkers.cancelQueued")}
                          </button>
                        </Show>
                        <Show when={entry()?.sessionID && ["running", "waiting"].includes(entry()?.state ?? "")}>
                          <div class="flex flex-wrap gap-2">
                            <button
                              class={secondary}
                              disabled={state.busy}
                              onClick={() =>
                                setState("instruction", {
                                  key: `${batch().id}/${task().id}`,
                                  id: `msg_${uuid()}`,
                                  text: "",
                                  delivery: "steer",
                                })
                              }
                            >
                              {language.t("agents.orient")}
                            </button>
                            <button
                              class={button({ variant: "ghost", tone: "danger", size: "sm" })}
                              disabled={state.busy}
                              onClick={() =>
                                action(() =>
                                  api().control({ id: batch().id, payload: { kind: "interrupt", task: task().id } }),
                                )
                              }
                            >
                              {language.t("agents.interrupt")}
                            </button>
                          </div>
                          <Show when={state.instruction.key === `${batch().id}/${task().id}`}>
                            <form
                              class="flex flex-col gap-2"
                              onSubmit={(event) => {
                                event.preventDefault()
                                action(async () => {
                                  await api().control({
                                    id: batch().id,
                                    payload: {
                                      kind: "prompt",
                                      task: task().id,
                                      id: state.instruction.id,
                                      text: state.instruction.text.trim(),
                                      delivery: state.instruction.delivery,
                                    },
                                  })
                                  if (lifetime.active) setState("instruction", "key", "")
                                })
                              }}
                            >
                              <label>
                                {language.t("agents.instruction")}
                                <textarea
                                  class={textarea()}
                                  required
                                  disabled={state.busy}
                                  value={state.instruction.text}
                                  onInput={(event) =>
                                    setState("instruction", {
                                      text: event.currentTarget.value,
                                      id: `msg_${uuid()}`,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                {language.t("agents.delivery")}
                                <select
                                  aria-label={language.t("agents.delivery")}
                                  class={input()}
                                  value={state.instruction.delivery}
                                  disabled={state.busy}
                                  onChange={(event) =>
                                    setState("instruction", {
                                      delivery: event.currentTarget.value as "steer" | "queue",
                                      id: `msg_${uuid()}`,
                                    })
                                  }
                                >
                                  <option value="steer">{language.t("agents.steer")}</option>
                                  <option value="queue">{language.t("agents.queue")}</option>
                                </select>
                              </label>
                              <button
                                class={button({ variant: "primary", size: "sm" })}
                                type="submit"
                                disabled={state.busy || !state.instruction.text.trim()}
                              >
                                {language.t("agents.send")}
                              </button>
                            </form>
                          </Show>
                        </Show>
                        <Show when={entry()?.text}>
                          <details>
                            <summary>{language.t("remoteWorkers.response")}</summary>
                            <pre class="whitespace-pre-wrap font-sans">{entry()?.text}</pre>
                          </details>
                        </Show>
                        <Show when={entry()?.state === "unknown" || entry()?.state === "dispatching"}>
                          <button
                            class={secondary}
                            disabled={state.busy || batch().observing}
                            onClick={() => action(() => api().recover({ id: batch().id, task: task().id }))}
                          >
                            {language.t("remoteWorkers.recover")}
                          </button>
                        </Show>
                        <Show
                          when={
                            entry()?.sessionID && ["succeeded", "failed", "interrupted"].includes(entry()?.state ?? "")
                          }
                        >
                          <button
                            class={secondary}
                            disabled={state.busy}
                            onClick={(event) => {
                              reviewOpener = event.currentTarget
                              action(async () => {
                                const result = await api().collect({ id: batch().id, task: task().id })
                                if (lifetime.active)
                                  setState({
                                    artifact: Schema.decodeUnknownSync(Worker.Artifact)(result),
                                    artifactPrompt: task().prompt,
                                  })
                              })
                            }}
                          >
                            {language.t("remoteWorkers.review")}
                          </button>
                        </Show>
                      </article>
                    )
                  }}
                </Key>
              </div>
            </section>
          )}
        </Key>
      </div>
    </div>
  )
}
