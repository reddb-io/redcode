import { useQuery } from "@tanstack/solid-query"
import { useSearchParams } from "@solidjs/router"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { DialogServer } from "@/servers/connect/dialog"
import { errorMessage } from "@/shell/layout/helpers"

export default function AgentMachines(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()
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
  })
  const target = () => servers.visible.find((server) => ServerConnection.key(server) === state.selected)
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
  const routeEligible = () => {
    const selected = target()
    if (!selected || !selected.http.password) return false
    // A desktop-owned forward is not reachable from a remote coordinator. Never copy it there.
    return !loopback(selected.http.url) || loopback(props.server.http.url)
  }
  return (
    <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <p class="text-ink-muted">{language.t("agentMachines.description")}</p>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <article class={appearance.root()}>
        <div class={appearance.body({ class: "flex flex-col gap-3" })}>
          <h3 class="text-13-medium">{language.t("agentMachines.connect")}</h3>
          <p>{language.t("agentMachines.connectNote")}</p>
          <AddServerMenu
            onAddServer={() =>
              dialog.show(() => (
                <DialogServer
                  mode="add"
                  onSave={(server) => setState({ selected: ServerConnection.key(server), checked: true })}
                />
              ))
            }
          />
        </div>
      </article>
      <article class={appearance.root()}>
        <div class={appearance.body({ class: "flex flex-col gap-3" })}>
          <h3 class="text-13-medium">{language.t("agentMachines.inspect")}</h3>
          <label>
            {language.t("agentMachines.machine")}
            <select
              aria-label={language.t("agentMachines.machine")}
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.selected}
              onChange={(event) => setState({ selected: event.currentTarget.value, checked: false, registered: false })}
            >
              <option value="">{language.t("agentMachines.choose")}</option>
              <For each={servers.visible}>
                {(server) => <option value={ServerConnection.key(server)}>{serverName(server)}</option>}
              </For>
            </select>
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
        </div>
      </article>
      <form
        class={appearance.root()}
        onSubmit={(event) => {
          event.preventDefault()
          void action(async () => {
            const selected = target()
            if (!selected || !routeEligible()) throw new Error(language.t("agentMachines.routeUnavailable"))
            const location = await global
              .ensureServerCtx(selected)
              .sdk.api.location.get({ location: { directory: state.directory } })
            await global.ensureServerCtx(props.server).sdk.api.workers.add({
              id: state.id,
              url: selected.http.url,
              password: selected.http.password!,
              directories: [location.directory],
              tags: state.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
            if (lifetime.active) setState("registered", true)
          })
        }}
      >
        <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2" })}>
          <h3 class="text-13-medium sm:col-span-2">{language.t("agentMachines.register")}</h3>
          <p class="text-ink-muted sm:col-span-2">
            {language.t("agentMachines.coordinator", { name: serverName(props.server) })}
          </p>
          <label>
            {language.t("agentMachines.workerID")}
            <input
              required
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.id}
              onInput={(event) => setState("id", event.currentTarget.value)}
            />
          </label>
          <label>
            {language.t("agentMachines.tags")}
            <input
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.tags}
              onInput={(event) => setState("tags", event.currentTarget.value)}
            />
          </label>
          <label class="sm:col-span-2">
            {language.t("agentMachines.directory")}
            <input
              required
              class={input({ size: "sm", class: "mt-1 w-full" })}
              value={state.directory}
              onInput={(event) => setState("directory", event.currentTarget.value)}
            />
          </label>
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
            {language.t("agentMachines.register")}
          </Button>
          <Show when={state.registered}>
            <p role="status">{language.t("agentMachines.registered")}</p>
            <Button
              variant="outline"
              onClick={() => setParams({ view: "remote", host: ServerConnection.key(props.server) })}
            >
              {language.t("remoteWorkers.title")}
            </Button>
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
