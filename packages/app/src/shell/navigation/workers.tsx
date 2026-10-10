import { Button } from "@opencode/ui/button"
import { useQuery } from "@tanstack/solid-query"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

/** Polls the optional daemon only while its project is visible in the fleet view. */
export function AgentWorkers(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const context = () => global.ensureServerCtx(props.server)
  const [state, setState] = createStore({
    directory: "",
    busy: false,
    target: "",
    worker: "",
    text: "",
    confirming: "",
  })
  const lifetime = { active: true }
  onCleanup(() => (lifetime.active = false))
  const directory = () => state.directory || context().projects.list()[0]?.worktree
  const location = () => ({ directory: directory() })
  const query = useQuery(() => ({
    queryKey: ["agents-workers", ServerConnection.key(props.server), directory()],
    enabled: !!directory() && context().sdk.connection.status() === "connected",
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      context().sdk.api.redskilled.status({ location: location(), scope: "project" }, { signal }),
    retry: false,
    refetchInterval: 5000,
  }))
  const status = () => query.data?.data
  const target = () => state.target || String(status()?.activation?.target ?? status()?.queue?.target ?? 1)
  const workers = () => status()?.payload?.workers ?? []
  const live = () => status()?.lifecycle === "live" || status()?.lifecycle === "degraded"
  const run = (request: () => Promise<unknown>) => {
    if (state.busy) return
    setState("busy", true)
    void request()
      .then(() => {
        if (!lifetime.active) return
        setState({ worker: "", text: "", confirming: "" })
        void query.refetch()
      })
      .catch((error) => {
        if (!lifetime.active) return
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        })
      })
      .finally(() => {
        if (lifetime.active) setState("busy", false)
      })
  }
  return (
    <div class="space-y-3">
      <Show when={directory()} fallback={<p>{language.t("agents.noProject")}</p>}>
        <label class="flex items-center gap-2 text-13-regular">
          {language.t("agents.project")}
          <select
            class="min-w-0 flex-1"
            disabled={state.busy}
            value={directory()}
            onChange={(event) =>
              setState({ directory: event.currentTarget.value, target: "", worker: "", text: "", confirming: "" })
            }
          >
            <For each={context().projects.list()}>
              {(project) => <option value={project.worktree}>{project.name ?? project.worktree}</option>}
            </For>
          </select>
        </label>
        <Show when={query.isPending && context().sdk.connection.status() === "connected"}>
          <p role="status">{language.t("common.loading")}</p>
        </Show>
        <Show when={context().sdk.connection.status() !== "connected"}>
          <p role="status">{language.t("agents.reconnecting")}</p>
        </Show>
        <Show when={status()?.lifecycle === "connecting"}>
          <p role="status">{language.t("agents.workersConnecting")}</p>
        </Show>
        <Show when={status()?.lifecycle === "ineligible"}>
          <p role="status">{language.t("agents.workersIneligible")}</p>
        </Show>
        <Show when={query.isError || status()?.lifecycle === "unavailable"}>
          <p role="status" class="text-13-regular text-v2-text-text-muted">
            {language.t("agents.workersUnavailable")}
          </p>
          <Show when={query.error || status()?.error}>
            <p class="break-words text-12-regular text-v2-text-text-muted">
              {errorMessage(query.error ?? status()?.error, language.t("common.requestFailed"))}
            </p>
          </Show>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {language.t("common.retry")}
          </Button>
        </Show>
        <Show when={status()?.lifecycle === "needs_consent" || status()?.lifecycle === "refused"}>
          <Button
            variant="outline"
            disabled={state.busy}
            onClick={() =>
              run(() => context().sdk.api.redskilled.consent({ location: location(), decision: "accepted" }))
            }
          >
            {language.t("agents.startWorkers")}
          </Button>
        </Show>
        <Show when={live()}>
          <div class="flex flex-wrap gap-2">
            <label class="flex items-center gap-2 text-13-regular">
              {language.t("agents.workerTarget")}
              <input
                type="number"
                min="0"
                step="1"
                disabled={state.busy}
                class="w-16 rounded-md border border-v2-border-border-base bg-transparent px-2 py-1"
                value={target()}
                onInput={(event) => setState("target", event.currentTarget.value)}
              />
            </label>
            <Button
              size="small"
              variant="outline"
              disabled={state.busy || !Number.isInteger(Number(target())) || Number(target()) < 0}
              onClick={() =>
                run(() =>
                  context().sdk.api.redskilled.project.resize({ location: location(), target: Number(target()) }),
                )
              }
            >
              {language.t("agents.resize")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={state.busy}
              onClick={() => setState("confirming", "project")}
            >
              {language.t("agents.stopProject")}
            </Button>
          </div>
          <Show when={status()?.queue}>
            {(queue) => <p class="text-12-regular text-v2-text-text-muted">{queue().detail}</p>}
          </Show>
          <Show when={!workers().length}>
            <p>{language.t("agents.noWorkers")}</p>
          </Show>
          <For each={workers()}>
            {(worker) => (
              <div class="rounded-lg border border-v2-border-border-base p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-13-medium">{worker.worker_id}</p>
                    <p class="truncate text-12-regular text-v2-text-text-muted">
                      {worker.display?.runner ?? worker.project_label} · {worker.display?.model} ·{" "}
                      {worker.display?.phase ?? worker.log.last_line}
                    </p>
                  </div>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={state.busy}
                    onClick={() => setState({ worker: worker.worker_id, text: "" })}
                  >
                    {language.t("agents.orient")}
                  </Button>
                  <Button
                    size="small"
                    variant="outline"
                    disabled={state.busy}
                    onClick={() => setState("confirming", worker.worker_id)}
                  >
                    {language.t("agents.stopWorker")}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={state.busy}
                    onClick={() => setState("confirming", `recycle:${worker.worker_id}`)}
                  >
                    {language.t("agents.recycle")}
                  </Button>
                </div>
                <Show when={state.worker === worker.worker_id}>
                  <form
                    class="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (state.text.trim())
                        run(() =>
                          context().sdk.api.redskilled.worker.steer({
                            location: location(),
                            worker: worker.worker_id,
                            text: state.text,
                          }),
                        )
                    }}
                  >
                    <textarea
                      class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-transparent p-2 text-13-regular"
                      aria-label={language.t("agents.instruction")}
                      value={state.text}
                      disabled={state.busy}
                      onInput={(event) => setState("text", event.currentTarget.value)}
                    />
                    <Button type="submit" size="small" disabled={state.busy || !state.text.trim()}>
                      {language.t("agents.send")}
                    </Button>
                  </form>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <Show when={state.confirming}>
          <div role="alert" class="rounded-lg border border-v2-border-border-base p-3">
            <p class="mb-2 text-13-regular">{language.t("agents.confirmControl")}</p>
            <div class="flex gap-2">
              <Button
                size="small"
                disabled={state.busy}
                onClick={() =>
                  run(() =>
                    state.confirming === "project"
                      ? context().sdk.api.redskilled.project.stop({ location: location() })
                      : state.confirming.startsWith("recycle:")
                        ? context().sdk.api.redskilled.worker.recycle({
                            location: location(),
                            worker: state.confirming.slice(8),
                          })
                        : context().sdk.api.redskilled.worker.stop({ location: location(), worker: state.confirming }),
                  )
                }
              >
                {language.t("agents.confirm")}
              </Button>
              <Button size="small" variant="ghost" disabled={state.busy} onClick={() => setState("confirming", "")}>
                {language.t("common.cancel")}
              </Button>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}
