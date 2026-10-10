import { Worker } from "@opencode/schema/worker"
import { button } from "@reddb-io/design-system/contracts/button"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { useQuery } from "@tanstack/solid-query"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"

export function RemoteWorkers(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
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
    drafts: [] as Worker.Task[],
    busy: false,
    error: "",
    removing: "",
    artifact: undefined as Worker.Artifact | undefined,
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
  const secondary = button({ variant: "secondary", size: "sm" })
  const draft = (): Worker.Task => ({
    id: `task-${crypto.randomUUID()}`,
    prompt: state.prompt.trim(),
    ...(state.target ? { worker: state.target } : {}),
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
  return (
    <div class="flex flex-col gap-4 text-sm leading-5">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-medium">{language.t("remoteWorkers.title")}</h3>
          <p class="text-ink-muted">{language.t("remoteWorkers.description")}</p>
        </div>
        <button
          class={secondary}
          disabled={state.busy || active() || !query.data?.available}
          onClick={() => setState("adding", !state.adding)}
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
      <Show when={state.error}>
        <p role="alert" class="text-feedback-danger">
          {state.error}
        </p>
      </Show>
      <Show when={state.adding}>
        <form
          class={appearance.root()}
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
              if (lifetime.active) setState({ adding: false, id: "", url: "", directory: "", password: "", tags: "", resourceID: "" })
            })
          }}
        >
          <div class={`${appearance.body()} grid gap-3 sm:grid-cols-2`}>
            <label class="flex flex-col gap-1">
              {language.t("remoteWorkers.resourceID")}
              <input class={input()} value={state.resourceID} onInput={(event) => setState("resourceID", event.currentTarget.value)} />
            </label>
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
            <label class="sm:col-span-2">
              {language.t("remoteWorkers.tags")}
              <input
                class={input()}
                value={state.tags}
                onInput={(event) => setState("tags", event.currentTarget.value)}
              />
            </label>
            <p class="sm:col-span-2 text-ink-muted">{language.t("remoteWorkers.credentials")}</p>
          </div>
          <div class={appearance.footer()}>
            <button class={button({ variant: "primary", size: "sm" })} type="submit" disabled={state.busy}>
              {language.t("remoteWorkers.connect")}
            </button>
            <button class={secondary} type="button" onClick={() => setState({ adding: false, password: "" })}>
              {language.t("common.cancel")}
            </button>
          </div>
        </form>
      </Show>
      <Show when={query.data?.available && !query.data.workers.length}>
        <p class="text-ink-muted">{language.t("remoteWorkers.empty")}</p>
      </Show>
      <For each={query.data?.workers}>
        {(status) => (
          <article class={appearance.root()}>
            <div class={`${appearance.body()} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <h4 class="font-medium">
                  {status.worker.id} · {language.t(`remoteWorkers.connection.${status.connection}`)}
                </h4>
                <p class="break-all text-ink-muted">{status.worker.url}</p>
                <p class="break-all">{status.worker.directories.join(" · ")}</p>
                <Show when={status.platform}>
                  <p class="text-ink-muted">
                    {status.platform} · {status.worker.tags.join(", ")}
                  </p>
                </Show>
              </div>
              <div class="flex gap-2">
                <button
                  class={secondary}
                  disabled={state.busy}
                  onClick={() => action(() => api().probe({ id: status.worker.id }))}
                >
                  {language.t("remoteWorkers.probe")}
                </button>
                <button
                  class={button({ variant: "ghost", tone: "danger", size: "sm" })}
                  disabled={state.busy || active()}
                  onClick={() => setState("removing", status.worker.id)}
                >
                  {language.t("remoteWorkers.remove")}
                </button>
              </div>
            </div>
            <Show when={state.removing === status.worker.id}>
              <div class={appearance.footer()}>
                <p>{language.t("remoteWorkers.confirmRemove", { worker: status.worker.id })}</p>
                <button
                  class={secondary}
                  disabled={state.busy}
                  onClick={() =>
                    action(async () => {
                      await api().remove({ id: status.worker.id })
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
      </For>
      <Show when={query.data?.available && query.data.workers.length}>
        <form
          class={appearance.root()}
          onSubmit={(event) => {
            event.preventDefault()
            action(async () => {
              await api().submit({ tasks: [...state.drafts, ...(state.prompt.trim() ? [draft()] : [])] })
              if (lifetime.active) setState({ prompt: "", drafts: [] })
            })
          }}
        >
          <div class={`${appearance.body()} flex flex-col gap-3`}>
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
              <select
                aria-label={language.t("remoteWorkers.target")}
                class={input()}
                disabled={state.busy || active()}
                value={state.target}
                onChange={(event) => setState("target", event.currentTarget.value)}
              >
                <option value="" selected={!state.target}>
                  {language.t("remoteWorkers.any")}
                </option>
                <For each={query.data?.workers}>
                  {(status) => (
                    <option value={status.worker.id} selected={state.target === status.worker.id}>
                      {status.worker.id}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <Show when={active()}>
              <p class="text-ink-muted">{language.t("remoteWorkers.active")}</p>
            </Show>
            <For each={state.drafts}>
              {(task) => (
                <div class="flex items-center justify-between gap-2">
                  <p class="whitespace-pre-wrap">{task.prompt}</p>
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
                </div>
              )}
            </For>
          </div>
          <div class={appearance.footer()}>
            <button
              type="button"
              class={secondary}
              disabled={state.busy || active() || !state.prompt.trim()}
              onClick={() => {
                setState("drafts", [...state.drafts, draft()])
                setState("prompt", "")
              }}
            >
              {language.t("remoteWorkers.addTask")}
            </button>
            <button
              type="submit"
              class={button({ variant: "primary", size: "sm" })}
              disabled={state.busy || active() || (!state.prompt.trim() && !state.drafts.length)}
            >
              {language.t("remoteWorkers.dispatch")}
            </button>
          </div>
        </form>
      </Show>
      <For each={query.data?.batches}>
        {(batch) => (
          <section class={appearance.root()}>
            <div class={appearance.header()}>
              <h4 class={appearance.title()}>{language.t("remoteWorkers.batch")}</h4>
              <p class={appearance.description()}>{batch.createdAt}</p>
            </div>
            <div class={`${appearance.body()} flex flex-col gap-3`}>
              <Show when={batch.error}>
                <p role="status" class="text-feedback-warning">
                  {batch.error}
                </p>
              </Show>
              <For each={batch.manifest.tasks}>
                {(task) => {
                  const entry = () => batch.report?.tasks.find((item) => item.id === task.id)
                  return (
                    <article class="flex flex-col gap-2 border-b border-muted pb-3 last:border-b-0">
                      <p class="whitespace-pre-wrap">{task.prompt}</p>
                      <p class="text-ink-muted">
                        {language.t(`remoteWorkers.state.${entry()?.state ?? "queued"}`)}
                        <Show when={entry()?.worker}> · {entry()?.worker}</Show>
                      </p>
                      <Show when={entry()?.state === "waiting"}>
                        <p>{language.t("remoteWorkers.waiting")}</p>
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
                          disabled={state.busy || batch.observing}
                          onClick={() => action(() => api().recover({ id: batch.id, task: task.id }))}
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
                          onClick={() =>
                            action(async () => {
                              const result = await api().collect({ id: batch.id, task: task.id })
                              if (lifetime.active) setState("artifact", result)
                            })
                          }
                        >
                          {language.t("remoteWorkers.review")}
                        </button>
                      </Show>
                    </article>
                  )
                }}
              </For>
            </div>
          </section>
        )}
      </For>
      <Show when={state.artifact}>
        {(artifact) => (
          <section class={appearance.root()}>
            <div class={appearance.header()}>
              <h4 class={appearance.title()}>{language.t("remoteWorkers.changes")}</h4>
              <p class={appearance.description()}>{language.t("remoteWorkers.reviewDescription")}</p>
            </div>
            <div class={appearance.body()}>
              <For each={artifact().files}>
                {(file) => (
                  <details>
                    <summary>
                      {file.file} (+{file.additions} / −{file.deletions})
                    </summary>
                    <pre class="max-h-80 overflow-auto whitespace-pre text-xs">{file.patch}</pre>
                  </details>
                )}
              </For>
              <Show when={!artifact().files.length}>
                <p>{language.t("remoteWorkers.noChanges")}</p>
              </Show>
            </div>
            <div class={appearance.footer()}>
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
              <button class={secondary} onClick={() => setState("artifact", undefined)}>
                {language.t("common.close")}
              </button>
            </div>
          </section>
        )}
      </Show>
    </div>
  )
}
