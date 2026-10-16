import { useSearchParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { Button } from "@opencode/ui/button"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { WorktreeReview } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"

export default function AgentWorktrees(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const [params, setParams] = useSearchParams()
  const api = () => global.ensureServerCtx(props.server).sdk.api
  const [state, setState] = createStore({
    projectID: "",
    directory: "",
    name: "",
    branch: "",
    target: "",
    selected: "",
    message: "",
    busy: false,
    error: "",
    archive: false,
    review: undefined as WorktreeReview | undefined,
  })
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  const appearance = card({ padding: "md" })
  const connected = () => global.ensureServerCtx(props.server).sdk.connection.status() === "connected"
  const projects = useQuery(() => ({
    queryKey: ["worktree-projects", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => api().project.list({}, { signal }),
    enabled: connected(),
    retry: false,
  }))
  const projectID = () => state.projectID || (typeof params.project === "string" ? params.project : "")
  const project = () => projects.data?.find((item) => item.id === projectID())
  const inventory = useQuery(() => ({
    queryKey: ["worktree-inventory", ServerConnection.key(props.server), projectID()],
    queryFn: ({ signal }) => api().worktree.list({ projectID: projectID() }, { signal }),
    enabled: connected() && !!projectID(),
    retry: false,
  }))
  const archives = useQuery(() => ({
    queryKey: ["worktree-archives", ServerConnection.key(props.server), projectID()],
    queryFn: ({ signal }) => api().worktreeLifecycle.archives({ projectID: projectID() }, { signal }),
    enabled: connected() && !!projectID(),
    retry: false,
  }))
  const target = () => state.target || project()?.canonical || ""
  const action = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    try {
      await run()
      if (lifetime.active) {
        void projects.refetch()
        if (projectID()) {
          void inventory.refetch()
          void archives.refetch()
        }
      }
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  const review = async (directory: string) => {
    const result = await api().worktreeLifecycle.inspect({ projectID: projectID(), directory, target: target() })
    if (lifetime.active) setState({ review: result, selected: directory, archive: false })
  }
  return (
    <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <p class="text-ink-muted">{language.t("agentWorktrees.description")}</p>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <Show when={projects.isError || inventory.isError}>
        <p role="alert">{language.t("agentWorktrees.unavailable")}</p>
      </Show>
      <form
        class={appearance.root()}
        onSubmit={(event) => {
          event.preventDefault()
          void action(async () => {
            const location = await api().location.get({ location: { directory: state.directory } })
            if (lifetime.active) {
              setState({ projectID: location.project.id, target: "", review: undefined })
              setParams({ project: location.project.id })
            }
          })
        }}
      >
        <div class={appearance.body({ class: "flex flex-col gap-3" })}>
          <h3 class="text-13-medium">{language.t("agentWorktrees.repository")}</h3>
          <label>
            {language.t("agentWorktrees.directory")}
            <input
              required
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.directory}
              onInput={(event) => setState("directory", event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={state.busy || !state.directory.trim() || !connected()}>
            {language.t("agentWorktrees.load")}
          </Button>
          <label>
            {language.t("agentWorktrees.project")}
            <select
              aria-label={language.t("agentWorktrees.project")}
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={projectID()}
              onChange={(event) => {
                setState({
                  projectID: event.currentTarget.value,
                  target: "",
                  review: undefined,
                  selected: "",
                  archive: false,
                })
                setParams({ project: event.currentTarget.value })
              }}
            >
              <option value="">{language.t("agentWorktrees.choose")}</option>
              <For each={projects.data}>{(item) => <option value={item.id}>{item.name || item.canonical}</option>}</For>
            </select>
          </label>
        </div>
      </form>
      <Show when={projectID()}>
        <form
          class={appearance.root()}
          onSubmit={(event) => {
            event.preventDefault()
            void action(async () => {
              const result = await api().worktree.create({
                projectID: projectID(),
                from: target(),
                name: state.name,
                ...(state.branch.trim() ? { branch: state.branch.trim() } : {}),
              })
              if (lifetime.active) setState({ selected: result.directory, name: "", review: undefined })
            })
          }}
        >
          <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2" })}>
            <h3 class="text-13-medium sm:col-span-2">{language.t("agentWorktrees.create")}</h3>
            <label>
              {language.t("agentWorktrees.name")}
              <input
                required
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.name}
                onInput={(event) => setState("name", event.currentTarget.value)}
              />
            </label>
            <label>
              {language.t("agentWorktrees.base")}
              <input
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.branch}
                onInput={(event) => setState("branch", event.currentTarget.value)}
              />
            </label>
            <label class="sm:col-span-2">
              {language.t("agentWorktrees.target")}
              <select
                aria-label={language.t("agentWorktrees.target")}
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={target()}
                onChange={(event) => setState({ target: event.currentTarget.value, review: undefined, archive: false })}
              >
                <For each={inventory.data}>{(item) => <option value={item.directory}>{item.directory}</option>}</For>
              </select>
            </label>
            <Button type="submit" disabled={state.busy || !state.name.trim() || !target()}>
              {language.t("agentWorktrees.create")}
            </Button>
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => void action(() => api().worktree.refresh({ projectID: projectID() }))}
            >
              {language.t("agentWorktrees.discover")}
            </Button>
          </div>
        </form>
        <For each={inventory.data}>
          {(item) => (
            <article class={appearance.root()} aria-label={item.directory}>
              <div class={appearance.body({ class: "flex flex-col gap-3" })}>
                <h3 class="break-all text-13-medium">{item.directory}</h3>
                <p class="text-ink-muted">
                  {language.t(item.strategy ? "agentWorktrees.managed" : "agentWorktrees.root")}
                </p>
                <div class="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={state.busy || !target()}
                    onClick={() => void action(() => review(item.directory))}
                  >
                    {language.t("agentWorktrees.review")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setParams({
                        view: "harness",
                        directory: item.directory,
                        host: ServerConnection.key(props.server),
                      })
                    }
                  >
                    {language.t("agentWorktrees.startAgent")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setParams({
                        view: "project-environments",
                        directory: item.directory,
                        host: ServerConnection.key(props.server),
                      })
                    }
                  >
                    {language.t("projectEnvironments.title")}
                  </Button>
                </div>
              </div>
            </article>
          )}
        </For>
        <Show when={archives.data?.length}>
          <article class={appearance.root()}>
            <div class={appearance.body({ class: "flex flex-col gap-3" })}>
              <h3 class="text-13-medium">{language.t("agentWorktrees.archives")}</h3>
              <For each={archives.data}>
                {(archive) => (
                  <div class="flex flex-wrap items-center gap-2">
                    <span>
                      {archive.head.slice(0, 12)} · {archive.createdAt}
                    </span>
                    <Button
                      variant="outline"
                      disabled={state.busy}
                      onClick={() =>
                        void action(async () => {
                          await api().worktree.create({
                            projectID: projectID(),
                            from: target(),
                            branch: archive.reference,
                          })
                        })
                      }
                    >
                      {language.t("agentWorktrees.restore")}
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </article>
        </Show>
      </Show>
      <Show when={state.review}>
        {(result) => (
          <article class={appearance.root()}>
            <div class={appearance.body({ class: "flex flex-col gap-3" })}>
              <h3 class="text-13-medium">{language.t("agentWorktrees.review")}</h3>
              <p class="break-all">{result().directory}</p>
              <p>{result().branch || language.t("agentWorktrees.detached")}</p>
              <p class="break-all text-ink-muted">
                {language.t("agentWorktrees.revision", {
                  head: result().head.slice(0, 12),
                  target: result().targetHead.slice(0, 12),
                })}
              </p>
              <Show when={result().dirty}>
                <p role="status">{language.t("agentWorktrees.dirty")}</p>
                <pre class="max-h-40 overflow-auto whitespace-pre-wrap">{result().status}</pre>
                <label>
                  {language.t("agentWorktrees.message")}
                  <input
                    class={input({ size: "sm", class: "mt-1 w-full" })}
                    value={state.message}
                    onInput={(event) => setState("message", event.currentTarget.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={state.busy || !state.message.trim() || !result().managed}
                  onClick={() =>
                    void action(async () => {
                      await api().worktreeLifecycle.checkpoint({
                        projectID: projectID(),
                        directory: result().directory,
                        message: state.message,
                      })
                      await review(result().directory)
                    })
                  }
                >
                  {language.t("agentWorktrees.checkpoint")}
                </Button>
              </Show>
              <pre
                aria-label={language.t("agentWorktrees.diff")}
                class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-v2-border-base p-3"
              >
                {result().diff || language.t("agentWorktrees.noDiff")}
              </pre>
              <Show when={result().truncated}>
                <p role="status">{language.t("agentWorktrees.truncated")}</p>
              </Show>
              <div class="flex flex-wrap gap-2">
                <Button
                  disabled={
                    state.busy ||
                    result().dirty ||
                    result().targetDirty ||
                    !result().managed ||
                    result().directory === result().target ||
                    result().truncated
                  }
                  onClick={() =>
                    void action(async () => {
                      const next = await api().worktreeLifecycle.integrate({
                        projectID: projectID(),
                        directory: result().directory,
                        target: result().target,
                        head: result().head,
                        targetHead: result().targetHead,
                      })
                      if (lifetime.active) setState("review", next)
                    })
                  }
                >
                  {language.t("agentWorktrees.integrate")}
                </Button>
                <Button
                  variant="outline"
                  disabled={state.busy || result().dirty || !result().managed}
                  onClick={() => setState("archive", true)}
                >
                  {language.t("agentWorktrees.archive")}
                </Button>
              </div>
              <p class="text-ink-muted">{language.t("agentWorktrees.integrationNote")}</p>
              <Show when={state.archive}>
                <div role="alert" class="flex flex-col gap-2">
                  <p>{language.t("agentWorktrees.archiveConfirm")}</p>
                  <div class="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={state.busy}
                      onClick={() =>
                        void action(async () => {
                          await api().worktreeLifecycle.archive({
                            projectID: projectID(),
                            directory: result().directory,
                            head: result().head,
                          })
                          if (lifetime.active) setState({ review: undefined, archive: false, selected: "" })
                        })
                      }
                    >
                      {language.t("agentWorktrees.confirmArchive")}
                    </Button>
                    <Button variant="ghost" onClick={() => setState("archive", false)}>
                      {language.t("agentWorktrees.keep")}
                    </Button>
                  </div>
                </div>
              </Show>
            </div>
          </article>
        )}
      </Show>
    </div>
  )
}
