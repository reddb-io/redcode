import { useQuery } from "@tanstack/solid-query"
import { useSearchParams } from "@solidjs/router"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { Button } from "@opencode/ui/button"
import { SearchSelect } from "@opencode/ui/search-select"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { DialogServer } from "@/servers/connect/dialog"
import { errorMessage } from "@/shell/layout/helpers"
import { DirectoryPickerDialog } from "@/workspaces/selection/dialog"
import { useProjectActions } from "@/home/projects/actions"
import { useLayout } from "@/shell/state/layout"

export default function AgentMachines(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()
  const projectsActions = useProjectActions()
  const layout = useLayout()
  const [, setParams] = useSearchParams()
  const [state, setState] = createStore({
    selected: "",
    id: "",
    directory: "",
    tags: "",
    busy: false,
    error: "",
    checked: false,
    registered: false,
    connected: false,
    registration: false,
  })
  const target = () => servers.visible.find((server) => ServerConnection.key(server) === state.selected)
  const select = (key: string, connected = false) => {
    setState({ selected: key, checked: true, registered: false, connected, directory: "", id: "", tags: "", error: "" })
  }
  const appearance = card({ padding: "md" })
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  const system = useQuery(() => ({
    queryKey: ["machine-onboarding", state.selected],
    queryFn: ({ signal }) => global.ensureServerCtx(target()!).sdk.api.server.system({ signal }),
    enabled: !!target() && state.checked,
    retry: false,
  }))
  const projects = useQuery(() => ({
    queryKey: ["machine-projects", state.selected],
    queryFn: ({ signal }) => global.ensureServerCtx(target()!).sdk.api.project.list(undefined, { signal }),
    enabled: !!target() && state.checked,
    retry: false,
  }))
  createEffect(() => {
    const selected = target()
    if (selected && !state.id)
      setState(
        "id",
        serverName(selected)
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80),
      )
  })
  const action = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    try {
      await run()
    } catch (error) {
      if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed")))
    } finally {
      if (lifetime.active) setState("busy", false)
    }
  }
  const loopback = (url: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  const workerAddress = () => {
    const selected = target()
    if (!selected) return undefined
    // Self-registration uses the execution host's listener, not the Desktop's SSH forward.
    if (ServerConnection.key(selected) === ServerConnection.key(props.server))
      return system.data?.urls.find((url) => new URL(url).protocol === "http:" && loopback(url))
    return selected.http.url
  }
  const routeEligible = () => {
    const selected = target()
    if (!selected || !selected.http.password) return false
    // A desktop-owned forward is not reachable from a remote coordinator. Never copy it there.
    const address = workerAddress()
    if (!address) return false
    return (
      ServerConnection.key(selected) === ServerConnection.key(props.server) ||
      !loopback(address) ||
      (props.server.type !== "extension" && loopback(props.server.http.url))
    )
  }
  return (
    <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <p class="text-ink-muted">{language.t("agentMachines.description")}</p>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <article class={appearance.root()}>
        <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
          <h3 class="text-13-medium">{language.t("agentMachines.connect")}</h3>
          <p>{language.t("agentMachines.connectNote")}</p>
          <AddServerMenu
            onConnected={(key) => {
              if (lifetime.active) select(key, true)
            }}
            onAddServer={() =>
              dialog.show(() => (
                <DialogServer mode="add" onSave={(server) => select(ServerConnection.key(server), true)} />
              ))
            }
          />
          <Show when={state.connected && target()}>
            <p role="status">{language.t("agentMachines.connected", { name: serverName(target()) })}</p>
          </Show>
          <p class="text-ink-muted">{language.t("agentMachines.sshLifetime")}</p>
          <p>{language.t("agentMachines.remoteControl")}</p>
        </div>
      </article>
      <article class={appearance.root()}>
        <div class={appearance.body({ class: "flex flex-col gap-3 space-y-0" })}>
          <h3 class="text-13-medium">{language.t("agentMachines.inspect")}</h3>
          <label>
            {language.t("agentMachines.machine")}
            <SearchSelect
              label={language.t("agentMachines.machine")}
              class="mt-1 w-full"
              value={state.selected}
              placeholder={language.t("agentMachines.choose")}
              options={servers.visible.map((server) => ({
                value: ServerConnection.key(server),
                label: serverName(server),
                description: server.http.url,
              }))}
              onChange={(key) => select(key)}
              disabled={state.busy}
            />
          </label>
          <Button
            variant="outline"
            disabled={!target() || state.busy}
            onClick={() => {
              setState("checked", true)
              void system.refetch()
            }}
          >
            {language.t("agentMachines.check")}
          </Button>
          <Show when={system.isError}>
            <p role="alert">{language.t("agentMachines.unavailable")}</p>
          </Show>
          <Show when={system.data}>
            {(info) => (
              <div role="status">
                <p>{info().platform}</p>
                <p>{language.t("agentMachines.version", { version: info().version })}</p>
              </div>
            )}
          </Show>
          <p class="text-ink-muted">{language.t("agentMachines.credentials")}</p>
          <Button
            variant="outline"
            disabled={!system.data || system.isError || state.busy}
            onClick={() => {
              const selected = target()
              if (!selected) return
              layout.home.setSelection({ server: ServerConnection.key(selected) })
              setParams({ view: "remote", host: ServerConnection.key(selected) })
            }}
          >
            {language.t("agentMachines.useCoordinator")}
          </Button>
        </div>
      </article>
      <form
        class={appearance.root()}
        onSubmit={(event) => {
          event.preventDefault()
          void action(async () => {
            const selected = target()
            if (!selected || !routeEligible()) throw new Error(language.t("agentMachines.routeUnavailable"))
            const coordinator = props.server
            const registration = {
              id: state.id,
              url: workerAddress()!,
              password: selected.http.password!,
              tags: state.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
            const location = await global
              .ensureServerCtx(selected)
              .sdk.api.location.get({ location: { directory: state.directory } })
            await global.ensureServerCtx(coordinator).sdk.api.workers.add({
              ...registration,
              directories: [location.directory],
            })
            if (
              lifetime.active &&
              ServerConnection.key(coordinator) === ServerConnection.key(props.server) &&
              ServerConnection.key(selected) === state.selected
            )
              setState("registered", true)
          })
        }}
      >
        <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2 space-y-0" })}>
          <h3 class="text-13-medium sm:col-span-2">{language.t("agentMachines.selectProject")}</h3>
          <Show when={state.registration}>
            <p class="text-ink-muted sm:col-span-2">
              {language.t("agentMachines.coordinator", { name: serverName(props.server) })}
            </p>
            <label>
              {language.t("agentMachines.workerID")}
              <input
                required
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.id}
                disabled={state.busy}
                onInput={(event) => setState("id", event.currentTarget.value)}
              />
            </label>
            <label>
              {language.t("agentMachines.tags")}
              <input
                class={input({ size: "sm", class: "mt-1 w-full" })}
                value={state.tags}
                disabled={state.busy}
                onInput={(event) => setState("tags", event.currentTarget.value)}
              />
            </label>
          </Show>
          <Show when={projects.data?.length}>
            <label class="sm:col-span-2">
              {language.t("agentMachines.project")}
              <SearchSelect
                label={language.t("agentMachines.project")}
                class="mt-1 w-full"
                disabled={state.busy}
                value={state.directory}
                placeholder={language.t("agentMachines.chooseProject")}
                options={(projects.data ?? []).map((project) => ({
                  value: project.canonical,
                  label: project.name || project.canonical,
                  description: project.canonical,
                }))}
                onChange={(directory) => setState("directory", directory)}
              />
            </label>
          </Show>
          <label class="sm:col-span-2">
            {language.t("agentMachines.directory")}
            <input
              required
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.directory}
              disabled={state.busy}
              onInput={(event) => setState("directory", event.currentTarget.value)}
            />
          </label>
          <Button
            variant="outline"
            type="button"
            disabled={!target() || state.busy}
            onClick={() => {
              const selected = target()
              if (!selected) return
              dialog.show(() => (
                <DirectoryPickerDialog
                  server={selected}
                  start={state.directory || undefined}
                  onSelect={(directory) => {
                    if (lifetime.active && typeof directory === "string") setState("directory", directory)
                  }}
                />
              ))
            }}
          >
            {language.t("agentMachines.browse")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!system.data || system.isError || state.busy || !state.directory.trim()}
            onClick={() => {
              void action(async () => {
                const selected = target()
                if (!selected) return
                const location = await global
                  .ensureServerCtx(selected)
                  .sdk.api.location.get({ location: { directory: state.directory } })
                if (!lifetime.active) return
                layout.home.setSelection({ server: ServerConnection.key(selected) })
                projectsActions.newSession(selected, location.directory)
              })
            }}
          >
            {language.t("agentMachines.codeHere")}
          </Button>
          <Button
            variant="ghost-muted"
            type="button"
            class="sm:col-span-2"
            aria-expanded={state.registration}
            disabled={state.busy}
            onClick={() => setState("registration", !state.registration)}
          >
            {language.t("agentMachines.configureWorker")}
          </Button>
          <Show when={state.registration}>
            <Show when={target() && !routeEligible()}>
              <p role="status" class="sm:col-span-2">
                {language.t("agentMachines.routeUnavailable")}
              </p>
            </Show>
            <Button
              type="submit"
              disabled={
                state.busy ||
                !system.data ||
                system.isError ||
                !routeEligible() ||
                !state.id.trim() ||
                !state.directory.trim()
              }
            >
              {language.t("agentMachines.registerCheckout")}
            </Button>
            <Show when={state.registered}>
              <p role="status">{language.t("agentMachines.registered")}</p>
              <p>{language.t("agentMachines.dispatchNote")}</p>
              <Button
                variant="outline"
                onClick={() => setParams({ view: "remote", host: ServerConnection.key(props.server) })}
              >
                {language.t("remoteWorkers.title")}
              </Button>
            </Show>
          </Show>
          <Button
            variant="outline"
            disabled={!target()}
            onClick={() =>
              setParams({ view: "harness", host: state.selected, directory: state.directory || undefined })
            }
          >
            {language.t("agentMachines.harnesses")}
          </Button>
          <Button
            variant="outline"
            disabled={!target()}
            onClick={() => setParams({ view: "worktrees", host: state.selected })}
          >
            {language.t("agentWorktrees.title")}
          </Button>
        </div>
      </form>
    </div>
  )
}
