import { useSearchParams } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { Button } from "@opencode/ui/button"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { AbsolutePath } from "@opencode/schema/schema"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { uuid } from "@/runtime/persistence/uuid"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"

const initial = () => ({
  id: "dev",
  name: "",
  backend: "compose" as ProjectEnvironment.Definition["backend"],
  composeFile: "compose.yaml",
  prepare: "",
  start: "",
  stop: "",
  validate: "",
  timeoutSeconds: 300,
  secrets: {},
})

export default function ProjectEnvironments(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const [params] = useSearchParams()
  const api = () => global.ensureServerCtx(props.server).sdk.api
  const connected = () => global.ensureServerCtx(props.server).sdk.connection.status() === "connected"
  const [state, setState] = createStore({
    directory: typeof params.directory === "string" ? params.directory : "",
    loaded: "",
    revision: 0,
    definition: initial(),
    bindings: "",
    busy: false,
    error: "",
    notice: "",
    confirm: undefined as { recipe: ProjectEnvironment.Recipe; action: ProjectEnvironment.Action } | undefined,
  })
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  const appearance = card({ padding: "md" })
  const projects = useQuery(() => ({
    queryKey: ["environment-projects", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => api().project.list({}, { signal }),
    enabled: connected(),
    retry: false,
  }))
  const snapshot = useQuery(() => ({
    queryKey: ["project-environments", ServerConnection.key(props.server), state.loaded],
    queryFn: ({ signal }) => api().projectEnvironments.list({ directory: AbsolutePath.make(state.loaded) }, { signal }),
    enabled: connected() && !!state.loaded,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.environments.some((item) => item.state === "working") ? 1500 : false,
  }))
  const instances = createMemo(
    () => snapshot.data?.environments.filter((item) => item.directory === snapshot.data?.directory) ?? [],
  )
  const act = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "", notice: "" })
    try {
      await run()
      if (lifetime.active && state.loaded) await snapshot.refetch()
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  const edit = (recipe: ProjectEnvironment.Recipe) =>
    setState({
      revision: recipe.revision,
      definition: {
        id: recipe.id,
        name: recipe.name,
        backend: recipe.backend,
        composeFile: recipe.composeFile,
        prepare: recipe.prepare,
        start: recipe.start,
        stop: recipe.stop,
        validate: recipe.validate,
        timeoutSeconds: recipe.timeoutSeconds,
        secrets: recipe.secrets,
      },
      bindings: Object.entries(recipe.secrets)
        .map(([key, name]) => `${key}=${name}`)
        .join("\n"),
    })
  return (
    <div class="flex max-w-4xl flex-col gap-4">
      <p>{language.t("projectEnvironments.description")}</p>
      <p class="text-ink-muted">{language.t("projectEnvironments.execution")}</p>
      <form
        class="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setState({ loaded: state.directory.trim(), revision: 0, definition: initial(), bindings: "", error: "" })
        }}
      >
        <label class="min-w-0 flex-1">
          {language.t("projectEnvironments.directory")}
          <input
            required
            class={input({ size: "sm", class: "mt-1 w-full" })}
            value={state.directory}
            onInput={(event) => setState("directory", event.currentTarget.value)}
            list={`environment-projects-${ServerConnection.key(props.server)}`}
          />
          <datalist id={`environment-projects-${ServerConnection.key(props.server)}`}>
            <For each={projects.data}>
              {(project) => <option value={project.canonical}>{project.name ?? project.canonical}</option>}
            </For>
          </datalist>
        </label>
        <Button type="submit" disabled={!connected()}>
          {language.t("projectEnvironments.open")}
        </Button>
      </form>
      <Show when={state.error || snapshot.error}>
        <p role="alert">{state.error || errorMessage(snapshot.error, language.t("common.requestFailed"))}</p>
      </Show>
      <Show when={state.notice}>
        <p role="status">{state.notice}</p>
      </Show>
      <Show when={snapshot.data}>
        <p>{snapshot.data?.directory}</p>
        <form
          class={appearance.root()}
          onSubmit={(event) => {
            event.preventDefault()
            void act(async () => {
              const entries = state.bindings
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                  const index = line.indexOf("=")
                  if (index < 1) throw new Error(language.t("projectEnvironments.bindingFormat"))
                  return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
                })
              const recipe = await api().projectEnvironments.save({
                directory: snapshot.data!.directory,
                expectedRevision: state.revision,
                definition: { ...state.definition, secrets: Object.fromEntries(entries) },
              })
              if (lifetime.active) {
                edit(recipe)
                setState("notice", language.t("projectEnvironments.saved"))
              }
            })
          }}
        >
          <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2 space-y-0" })}>
            <h3 class="text-13-medium sm:col-span-2">{language.t("projectEnvironments.recipe")}</h3>
            <For
              each={
                state.definition.backend === "compose"
                  ? (["id", "name", "composeFile"] as const)
                  : (["id", "name"] as const)
              }
            >
              {(key) => (
                <label>
                  {language.t(`projectEnvironments.${key}`)}
                  <input
                    required
                    class={input({ size: "sm", class: "mt-1 w-full" })}
                    value={state.definition[key]}
                    disabled={state.busy || (key === "id" && state.revision > 0)}
                    onInput={(event) => setState("definition", key, event.currentTarget.value)}
                  />
                </label>
              )}
            </For>
            <label>
              {language.t("projectEnvironments.backend")}
              <select
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.definition.backend}
                onChange={(event) =>
                  setState("definition", "backend", event.currentTarget.value === "commands" ? "commands" : "compose")
                }
              >
                <option value="compose">{language.t("projectEnvironments.compose")}</option>
                <option value="commands">{language.t("projectEnvironments.commands")}</option>
              </select>
            </label>
            <p class="text-ink-muted sm:col-span-2">
              {language.t(
                state.definition.backend === "compose"
                  ? "projectEnvironments.composeHelp"
                  : "projectEnvironments.commandsHelp",
              )}
            </p>
            <For
              each={
                state.definition.backend === "commands"
                  ? (["prepare", "start", "stop", "validate"] as const)
                  : (["prepare", "validate"] as const)
              }
            >
              {(key) => (
                <label class="sm:col-span-2">
                  {language.t(`projectEnvironments.command.${key}`)}
                  <textarea
                    required={key !== "prepare"}
                    class={textarea({ class: "mt-1 w-full" })}
                    value={state.definition[key]}
                    onInput={(event) => setState("definition", key, event.currentTarget.value)}
                  />
                </label>
              )}
            </For>
            <label>
              {language.t("projectEnvironments.timeout")}
              <input
                type="number"
                min="1"
                max="1800"
                required
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.definition.timeoutSeconds}
                onInput={(event) => setState("definition", "timeoutSeconds", Number(event.currentTarget.value))}
              />
            </label>
            <label class="sm:col-span-2">
              {language.t("projectEnvironments.bindings")}
              <textarea
                class={textarea({ class: "mt-1 w-full" })}
                value={state.bindings}
                onInput={(event) => setState("bindings", event.currentTarget.value)}
              />
            </label>
            <p class="text-ink-muted sm:col-span-2">{language.t("projectEnvironments.bindingHelp")}</p>
            <div class="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={state.busy}>
                {language.t("projectEnvironments.save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setState({ revision: 0, definition: initial(), bindings: "" })}
              >
                {language.t("projectEnvironments.new")}
              </Button>
            </div>
          </div>
        </form>
        <For each={snapshot.data?.recipes}>
          {(recipe) => {
            const current = () => instances().find((item) => item.recipeID === recipe.id)
            return (
              <article aria-label={recipe.name} class={appearance.root()}>
                <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
                  <h3 class="text-13-medium">{recipe.name}</h3>
                  <p>{language.t("projectEnvironments.revision", { revision: recipe.revision })}</p>
                  <Show when={recipe.validatedRevision === recipe.revision}>
                    <p>{language.t("projectEnvironments.validated", { date: recipe.validatedAt ?? "" })}</p>
                  </Show>
                  <Show when={current()}>
                    {(item) => (
                      <>
                        <p role="status">{language.t(`projectEnvironments.state.${item().state}`)}</p>
                        <p class="text-ink-muted">
                          {language.t("projectEnvironments.lastOperation", { date: item().updatedAt })}
                        </p>
                        <p>{item().detail}</p>
                        <Show when={item().output}>
                          <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words">{item().output}</pre>
                        </Show>
                      </>
                    )}
                  </Show>
                  <div class="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={state.busy} onClick={() => edit(recipe)}>
                      {language.t("common.edit")}
                    </Button>
                    <For
                      each={
                        current()?.state === "reconcile"
                          ? (["reconcile"] as const)
                          : (["prepare", "start", "stop", "recreate", "validate"] as const)
                      }
                    >
                      {(action) => (
                        <Button
                          variant="outline"
                          disabled={state.busy || current()?.state === "working"}
                          onClick={() => setState("confirm", { recipe, action })}
                        >
                          {language.t(`projectEnvironments.action.${action}`)}
                        </Button>
                      )}
                    </For>
                  </div>
                  <Show when={state.confirm?.recipe.id === recipe.id}>
                    <p>
                      {language.t(
                        state.confirm?.action === "reconcile"
                          ? "projectEnvironments.reconcileConfirm"
                          : "projectEnvironments.runConfirm",
                      )}
                    </p>
                    <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                      {[
                        `${recipe.backend}: ${recipe.composeFile}`,
                        recipe.prepare,
                        recipe.start,
                        recipe.stop,
                        recipe.validate,
                      ]
                        .filter(Boolean)
                        .join("\n\n")}
                    </pre>
                    <div class="flex gap-2">
                      <Button
                        disabled={state.busy}
                        onClick={() =>
                          void act(async () => {
                            const selected = state.confirm!
                            await api().projectEnvironments.run({
                              directory: snapshot.data!.directory,
                              recipeID: recipe.id,
                              revision: recipe.revision,
                              action: selected.action,
                              requestID: uuid(),
                              ...(selected.action === "reconcile" ? { confirmReconciled: true } : {}),
                            })
                            if (lifetime.active) setState("confirm", undefined)
                          })
                        }
                      >
                        {language.t("projectEnvironments.confirm")}
                      </Button>
                      <Button variant="ghost" onClick={() => setState("confirm", undefined)}>
                        {language.t("common.cancel")}
                      </Button>
                    </div>
                  </Show>
                </div>
              </article>
            )
          }}
        </For>
        <Show when={snapshot.data?.recipes.length === 0}>
          <p>{language.t("projectEnvironments.empty")}</p>
        </Show>
      </Show>
    </div>
  )
}
