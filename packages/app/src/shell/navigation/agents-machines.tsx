import { useQuery } from "@tanstack/solid-query"
import { useSearchParams } from "@solidjs/router"
import { input } from "@reddb-io/design-system/contracts/input"
import { sidebarPanel } from "@reddb-io/design-system/contracts/sidebar-panel"
import { Button } from "@opencode/ui/button"
import { SearchSelect } from "@/runtime/react/search-select"
import { Steps } from "@opencode/ui/steps"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createUniqueId, on, onCleanup, Show } from "solid-js"
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
    step: 0,
    selected: "",
    id: "",
    directory: "",
    verifiedDirectory: "",
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
    if (state.selected === key) return
    setState({
      selected: key,
      checked: false,
      registered: false,
      connected,
      directory: "",
      verifiedDirectory: "",
      id: "",
      tags: "",
      error: "",
      registration: false,
    })
  }
  const directory = (value: string) => {
    if (value === state.directory) return
    setState({ directory: value, verifiedDirectory: "", registered: false, error: "" })
  }
  const panel = sidebarPanel()
  const registrationID = createUniqueId()
  let heading: HTMLHeadingElement | undefined
  const lifetime = { active: true }
  onCleanup(() => {
    lifetime.active = false
  })
  createEffect(
    on(
      () => ServerConnection.key(props.server),
      () => setState("registered", false),
    ),
  )
  createEffect(
    on(
      () => state.step,
      () =>
        queueMicrotask(() => {
          if (!lifetime.active) return
          heading?.focus({ preventScroll: true })
          heading?.scrollIntoView({ block: "nearest" })
        }),
      { defer: true },
    ),
  )
  const system = useQuery(() => ({
    queryKey: ["machine-onboarding", state.selected],
    queryFn: ({ signal }) => global.ensureServerCtx(target()!).sdk.api.server.system({ signal }),
    enabled: false,
    retry: false,
  }))
  const projects = useQuery(() => ({
    queryKey: ["machine-projects", state.selected],
    queryFn: ({ signal }) => global.ensureServerCtx(target()!).sdk.api.project.list(undefined, { signal }),
    enabled: !!target() && state.checked,
    retry: false,
    staleTime: 30_000,
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
  const action = async (run: () => Promise<unknown>, check?: "server" | "project") => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    try {
      await run()
    } catch (error) {
      if (lifetime.active) {
        const detail = errorMessage(error, language.t("common.requestFailed"))
        setState("error", check ? language.t(`agentMachines.setup.${check}Failed`, { detail }) : detail)
      }
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
  const projectVerified = () =>
    !!target() && state.checked && !!state.verifiedDirectory && state.verifiedDirectory === state.directory
  const available = () => (projectVerified() ? 3 : state.checked && target() ? 2 : target() ? 1 : 0)
  const labels = () => [
    language.t("agentMachines.setup.connect"),
    language.t("agentMachines.setup.check"),
    language.t("agentMachines.setup.project"),
    language.t("infrastructure.setup.use"),
  ]
  const manage = () => {
    const selected = target()
    if (!selected) return
    layout.home.setSelection({ server: ServerConnection.key(selected) })
    setParams({ view: "servers", host: ServerConnection.key(selected), setup: undefined })
  }
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-[var(--reddb-spatial-gap-md)] text-13-regular leading-[var(--line-height-base)]">
      <p class="shrink-0 text-ink-muted">{language.t("infrastructure.setup.description")}</p>
      <Steps
        label={language.t("infrastructure.setup.progress")}
        completedLabel={language.t("agentMachines.setup.completed")}
        items={labels().map((label, index) => ({
          id: String(index),
          label,
          state: index === state.step ? "current" : index < available() ? "complete" : "upcoming",
          select: index <= available() && !state.busy ? () => setState({ step: index, error: "" }) : undefined,
        }))}
      />
      <section
        aria-label={language.t("infrastructure.setup.progress")}
        class={panel.root({
          class: "flex-1 overflow-hidden rounded-lg border border-muted",
        })}
      >
        <header class={panel.header()}>
          <div class="min-w-0">
            <h3 ref={heading} tabIndex={-1} class="text-body font-medium outline-none">
              {labels()[state.step]}
            </h3>
            <Show when={target()}>
              {(server) => (
                <p class="text-caption text-ink-muted [overflow-wrap:anywhere]">
                  {serverName(server())} · {server().http.url}
                </p>
              )}
            </Show>
          </div>
        </header>
        <div
          aria-busy={state.busy}
          class={panel.body({ class: "flex flex-col gap-3 overflow-y-auto overscroll-contain" })}
        >
          <div hidden={state.step !== 0} class="flex flex-col gap-3 [&[hidden]]:hidden">
            <p>{language.t("agentMachines.connectNote")}</p>
            <SearchSelect
              label={language.t("infrastructure.setup.server")}
              class="w-full"
              value={state.selected}
              placeholder={language.t("infrastructure.setup.choose")}
              options={servers.visible.map((server) => ({
                value: ServerConnection.key(server),
                label: serverName(server),
                description: server.http.url,
              }))}
              onChange={(key) => select(key)}
              disabled={state.busy}
            />
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
            <p class="text-ink-muted">{language.t("agentMachines.remoteControl")}</p>
            <p class="text-ink-muted">{language.t("agentMachines.sshLifetime")}</p>
          </div>
          <div hidden={state.step !== 1} class="flex flex-col gap-3 [&[hidden]]:hidden">
            <p>{language.t("agentMachines.setup.checkNote")}</p>
            <Button
              variant="outline"
              disabled={!target() || state.busy}
              onClick={() =>
                void action(async () => {
                  const selected = state.selected
                  setState({ checked: false, verifiedDirectory: "", registered: false })
                  const result = await system.refetch()
                  if (!lifetime.active || selected !== state.selected) return
                  if (result.isError) throw result.error
                  setState("checked", true)
                }, "server")
              }
            >
              {language.t(state.busy ? "agentMachines.setup.checking" : "agentMachines.check")}
            </Button>
            <Show when={state.checked && system.data}>
              {(info) => (
                <div role="status">
                  <p>{language.t("agentMachines.setup.serverVerified")}</p>
                  <p>{info().platform}</p>
                  <p>{language.t("agentMachines.version", { version: info().version })}</p>
                </div>
              )}
            </Show>
            <p class="text-ink-muted">{language.t("agentMachines.credentials")}</p>
            <Button variant="outline" disabled={!target() || !state.checked || state.busy} onClick={manage}>
              {language.t("infrastructure.manageServer")}
            </Button>
          </div>
          <div hidden={state.step !== 2} class="flex flex-col gap-3 [&[hidden]]:hidden">
            <p>{language.t("agentMachines.setup.projectNote")}</p>
            <Show when={projects.isFetching}>
              <p role="status">{language.t("agents.loading")}</p>
            </Show>
            <Show when={projects.isError}>
              <p role="alert">{language.t("agentMachines.setup.projectsUnavailable")}</p>
              <Button variant="outline" disabled={state.busy} onClick={() => void projects.refetch()}>
                {language.t("common.retry")}
              </Button>
            </Show>
            <Show when={projects.data?.length}>
              <SearchSelect
                label={language.t("infrastructure.setup.project")}
                class="w-full"
                disabled={state.busy}
                value={state.directory}
                placeholder={language.t("agentMachines.chooseProject")}
                options={(projects.data ?? []).map((project) => ({
                  value: project.canonical,
                  label: project.name || project.canonical,
                  description: project.canonical,
                }))}
                onChange={directory}
              />
            </Show>
            <label class="flex flex-col gap-1">
              {language.t("agentMachines.directory")}
              <input
                class={input({ size: "sm", class: "w-full" })}
                value={state.directory}
                disabled={state.busy}
                onInput={(event) => directory(event.currentTarget.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={!target() || state.busy}
              onClick={() => {
                const selected = target()
                if (!selected) return
                dialog.show(() => (
                  <DirectoryPickerDialog
                    server={selected}
                    start={state.directory || undefined}
                    onSelect={(value) => {
                      if (lifetime.active && typeof value === "string") directory(value)
                    }}
                  />
                ))
              }}
            >
              {language.t("agentMachines.browse")}
            </Button>
          </div>
          <div hidden={state.step !== 3} class="flex flex-col gap-3 [&[hidden]]:hidden">
            <Show when={projectVerified()}>
              <div role="status">
                <p>{language.t("agentMachines.setup.projectVerified")}</p>
                <p class="text-mono [overflow-wrap:anywhere]">{state.verifiedDirectory}</p>
              </div>
            </Show>
            <p class="text-ink-muted">{language.t("agentMachines.setup.readyNote")}</p>
            <Button variant="outline" disabled={!target() || !state.checked || state.busy} onClick={manage}>
              {language.t("infrastructure.manageServer")}
            </Button>
            <Button
              variant="outline"
              aria-expanded={state.registration}
              disabled={state.busy}
              onClick={() => setState("registration", !state.registration)}
            >
              {language.t(state.registration ? "agentMachines.setup.cancelWorker" : "agentMachines.configureWorker")}
            </Button>
            <Show when={state.registration}>
              <form
                id={registrationID}
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void action(async () => {
                    const selected = target()
                    if (!selected || !projectVerified() || !routeEligible())
                      throw new Error(language.t("agentMachines.routeUnavailable"))
                    const coordinator = props.server
                    const registration = {
                      id: state.id.trim(),
                      url: workerAddress()!,
                      password: selected.http.password!,
                      tags: state.tags
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    }
                    const location = await global
                      .ensureServerCtx(selected)
                      .sdk.api.location.get({ location: { directory: state.verifiedDirectory } })
                    await global
                      .ensureServerCtx(coordinator)
                      .sdk.api.workers.add({ ...registration, directories: [location.directory] })
                    if (
                      lifetime.active &&
                      ServerConnection.key(coordinator) === ServerConnection.key(props.server) &&
                      ServerConnection.key(selected) === state.selected
                    )
                      setState("registered", true)
                  })
                }}
              >
                <p class="text-ink-muted">
                  {language.t("agentMachines.coordinator", { name: serverName(props.server) })}
                </p>
                <label class="flex flex-col gap-1">
                  {language.t("agentMachines.workerID")}
                  <input
                    required
                    pattern="[a-zA-Z0-9_-]+"
                    class={input({ size: "sm", class: "w-full" })}
                    value={state.id}
                    disabled={state.busy}
                    onInput={(event) => setState({ id: event.currentTarget.value, registered: false })}
                  />
                </label>
                <label class="flex flex-col gap-1">
                  {language.t("agentMachines.tags")}
                  <input
                    class={input({ size: "sm", class: "w-full" })}
                    value={state.tags}
                    disabled={state.busy}
                    onInput={(event) => setState({ tags: event.currentTarget.value, registered: false })}
                  />
                </label>
                <p class="text-ink-muted">{language.t("agentMachines.credentials")}</p>
                <Show when={target() && !routeEligible()}>
                  <p role="status">{language.t("agentMachines.routeUnavailable")}</p>
                </Show>
                <Show when={state.registered}>
                  <p role="status">{language.t("agentMachines.registered")}</p>
                  <p>{language.t("agentMachines.dispatchNote")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setParams({ view: "servers", host: ServerConnection.key(props.server), setup: undefined })
                    }
                  >
                    {language.t("infrastructure.viewWorkers")}
                  </Button>
                </Show>
              </form>
            </Show>
            <details>
              <summary class="min-h-[var(--reddb-spatial-target-min)] cursor-pointer py-[var(--reddb-spatial-gap-sm)]">
                {language.t("agentMachines.setup.tools")}
              </summary>
              <div class="flex flex-col gap-2">
                <Button
                  variant="outline"
                  disabled={!target() || state.busy}
                  onClick={() =>
                    setParams({ view: "harness", host: state.selected, directory: state.directory || undefined })
                  }
                >
                  {language.t("agentMachines.harnesses")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!target() || state.busy}
                  onClick={() => setParams({ view: "worktrees", host: state.selected })}
                >
                  {language.t("agentWorktrees.title")}
                </Button>
              </div>
            </details>
          </div>
        </div>
        <footer class={panel.footer({ class: "flex flex-col gap-2 bg-elevation-raised-surface" })}>
          <Show when={state.error}>
            <p role="alert" class="max-h-24 overflow-auto [overflow-wrap:anywhere]">
              {state.error}
            </p>
          </Show>
          <div class="flex flex-wrap gap-2">
            <Show when={state.step > 0}>
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => setState({ step: state.step - 1, error: "" })}
              >
                {language.t("agentMachines.setup.back")}
              </Button>
            </Show>
            <Show when={state.step === 3 && !state.registration}>
              <Button
                variant="submit"
                disabled={!projectVerified() || state.busy}
                onClick={() =>
                  void action(async () => {
                    const selected = target()
                    if (!selected) return
                    const location = await global
                      .ensureServerCtx(selected)
                      .sdk.api.location.get({ location: { directory: state.verifiedDirectory } })
                    if (!lifetime.active) return
                    layout.home.setSelection({ server: ServerConnection.key(selected) })
                    projectsActions.newSession(selected, location.directory)
                  })
                }
              >
                {language.t("agentMachines.codeHere")}
              </Button>
            </Show>
            <Show when={state.step === 3 && state.registration}>
              <Button
                variant="submit"
                type="submit"
                form={registrationID}
                disabled={state.busy || !projectVerified() || !routeEligible() || !state.id.trim() || state.registered}
              >
                {language.t("agentMachines.registerCheckout")}
              </Button>
            </Show>
            <Show when={state.step < 2}>
              <Button
                variant="submit"
                disabled={state.busy || available() <= state.step}
                onClick={() => setState({ step: state.step + 1, error: "" })}
              >
                {language.t("agentMachines.setup.continue")}
              </Button>
            </Show>
            <Show when={state.step === 2}>
              <Button
                variant="submit"
                disabled={state.busy || !state.checked || !target() || !state.directory.trim()}
                onClick={() =>
                  void action(async () => {
                    const selected = target()
                    if (!selected) return
                    const path = state.directory.trim()
                    const location = await global
                      .ensureServerCtx(selected)
                      .sdk.api.location.get({ location: { directory: path } })
                    if (!lifetime.active || ServerConnection.key(selected) !== state.selected) return
                    setState({ directory: location.directory, verifiedDirectory: location.directory, step: 3 })
                  }, "project")
                }
              >
                {language.t(state.busy ? "agentMachines.setup.checking" : "agentMachines.setup.checkProject")}
              </Button>
            </Show>
          </div>
        </footer>
      </section>
    </div>
  )
}
