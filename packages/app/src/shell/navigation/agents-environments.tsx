import { useQuery } from "@tanstack/solid-query"
import { useSearchParams } from "@solidjs/router"
import { card } from "@reddb-io/design-system/contracts/card"
import { input } from "@reddb-io/design-system/contracts/input"
import { textarea } from "@reddb-io/design-system/contracts/textarea"
import { Button } from "@opencode/ui/button"
import { For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"

export default function AgentEnvironments(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const servers = useServers()
  const [, setParams] = useSearchParams()
  const api = () => global.ensureServerCtx(props.server).sdk.api.workerEnvironments
  const [state, setState] = createStore({ id: "", repository: "", ref: "HEAD", image: "redcode-worker:0.80.0",
    version: "0.80.0", cpu: 1, memoryMiB: 1024, setup: "", provider: "", key: "", busy: false, error: "", notice: "",
    resourceID: "", coordinator: ServerConnection.key(props.server), confirm: "" })
  const lifetime = { active: true }
  onCleanup(() => { lifetime.active = false })
  const appearance = card({ padding: "md" })
  const query = useQuery(() => ({
    queryKey: ["worker-environments", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => api().list({ signal }), retry: false,
    enabled: global.ensureServerCtx(props.server).sdk.connection.status() === "connected", refetchInterval: 5000,
  }))
  const providers = useQuery(() => ({
    queryKey: ["environment-provider-options", ServerConnection.key(props.server)],
    queryFn: async ({ signal }) => (await global.ensureServerCtx(props.server).sdk.api.integration.list(undefined, { signal })).data,
    enabled: global.ensureServerCtx(props.server).sdk.connection.status() === "connected", retry: false,
  }))
  const action = async (run: () => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, error: "", notice: "" })
    try { await run(); if (lifetime.active) await query.refetch() }
    catch (error) { if (lifetime.active) setState("error", errorMessage(error, language.t("common.requestFailed"))) }
    finally { if (lifetime.active) setState("busy", false) }
  }
  return <div class="flex flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
    <p>{language.t("environments.description")}</p>
    <p class="text-ink-muted">{language.t("environments.policy")}</p>
    <Show when={query.isError}><p role="alert">{language.t("environments.access")}</p></Show>
    <Show when={query.data && !query.data.available}><p role="status">{language.t("environments.dockerUnavailable")}</p></Show>
    <Show when={state.error}><p role="alert">{state.error}</p></Show>
    <Show when={state.notice}><p role="status">{state.notice}</p></Show>
    <Show when={state.busy}><p role="status">{language.t("environments.working")}</p></Show>
    <article class={appearance.root()}>
      <div class={appearance.body({ class: "flex flex-col gap-3" })}>
        <h3 class="text-13-medium">{language.t("environments.imageTitle")}</h3>
        <p>{language.t("environments.imageDescription")}</p>
        <label>{language.t("environments.version")}<input class={input({ size: "sm", class: "mt-1 w-full" })}
          value={state.version} disabled={state.busy} onInput={(event) => setState("version", event.currentTarget.value)} /></label>
        <Button variant="outline" disabled={state.busy || !query.data?.available || !/^\d+\.\d+\.\d+$/.test(state.version)}
          onClick={() => void action(async () => {
            const result = await api().build({ version: state.version })
            if (lifetime.active) setState({ image: result.image, notice: language.t("environments.imageReady") })
          })}>{language.t("environments.build")}</Button>
      </div>
    </article>
    <form class={appearance.root()} onSubmit={(event) => {
      event.preventDefault()
      void action(async () => {
        const input = { id: state.id, repository: state.repository, ref: state.ref, image: state.image, cpu: state.cpu,
          memoryMiB: state.memoryMiB, ...(state.setup.trim() ? { setup: state.setup } : {}),
          ...(state.provider && state.key ? { provider: { integrationID: state.provider, key: state.key } } : {}) }
        setState("key", "")
        const result = await api().create(input)
        if (lifetime.active) setState("notice", language.t(result.state === "ready" ? "environments.ready" : "environments.failed"))
      })
    }}>
      <div class={appearance.body({ class: "grid gap-3 sm:grid-cols-2" })}>
        <h3 class="text-13-medium sm:col-span-2">{language.t("environments.prepare")}</h3>
        <For each={[
          ["id", "environments.name"], ["repository", "environments.repository"], ["ref", "environments.ref"], ["image", "environments.image"],
        ] as const}>{([field, label]) => <label>{language.t(label)}<input required disabled={state.busy}
          type={field === "repository" ? "url" : "text"} class={input({ size: "sm", class: "mt-1 w-full" })} value={state[field]}
          onInput={(event) => setState(field, event.currentTarget.value)} /></label>}</For>
        <label>{language.t("environments.cpu")}<input type="number" min="0.25" max="128" step="0.25" required disabled={state.busy}
          class={input({ size: "sm", class: "mt-1 w-full" })} value={state.cpu}
          onInput={(event) => setState("cpu", event.currentTarget.valueAsNumber)} /></label>
        <label>{language.t("environments.memory")}<input type="number" min="256" max="1048576" step="256" required disabled={state.busy}
          class={input({ size: "sm", class: "mt-1 w-full" })} value={state.memoryMiB}
          onInput={(event) => setState("memoryMiB", event.currentTarget.valueAsNumber)} /></label>
        <label class="sm:col-span-2">{language.t("environments.setup")}<textarea disabled={state.busy}
          class={textarea({ class: "mt-1 w-full" })} value={state.setup}
          onInput={(event) => setState("setup", event.currentTarget.value)} /></label>
        <p class="text-ink-muted sm:col-span-2">{language.t("environments.setupDescription")}</p>
        <label>{language.t("environments.provider")}<select aria-label={language.t("environments.provider")} disabled={state.busy}
          class={input({ size: "sm", class: "mt-1 w-full" })} value={state.provider}
          onChange={(event) => setState("provider", event.currentTarget.value)}>
          <option value="">{language.t("environments.noProvider")}</option>
          <For each={providers.data?.filter((provider) => provider.methods.some((method) => method.type === "key" && !method.form?.length))}>
            {(provider) => <option value={provider.id}>{provider.name}</option>}
          </For>
        </select></label>
        <label>{language.t("environments.key")}<input type="password" autocomplete="off" disabled={state.busy}
          class={input({ size: "sm", class: "mt-1 w-full" })} value={state.key}
          onInput={(event) => setState("key", event.currentTarget.value)} /></label>
        <p class="text-ink-muted sm:col-span-2">{language.t("environments.credentials")}</p>
        <Button type="submit" disabled={state.busy || !query.data?.available || !state.id.trim() || !state.repository.trim() || !!state.provider !== !!state.key}>
          {language.t("environments.create")}</Button>
      </div>
    </form>
    <article class={appearance.root()}><div class={appearance.body({ class: "flex flex-col gap-3" })}>
      <h3 class="text-13-medium">{language.t("environments.pool")}</h3>
      <label>{language.t("environments.coordinator")}<select aria-label={language.t("environments.coordinator")} class={input({ size: "sm", class: "mt-1 w-full" })} value={state.coordinator}
        onChange={(event) => setState("coordinator", event.currentTarget.value)}>
        <For each={servers.visible}>{(server) => <option value={ServerConnection.key(server)}>{serverName(server)}</option>}</For>
      </select></label>
      <label>{language.t("environments.resource")}<input class={input({ size: "sm", class: "mt-1 w-full" })}
        value={state.resourceID} onInput={(event) => setState("resourceID", event.currentTarget.value)} /></label>
      <p class="text-ink-muted">{language.t("environments.poolDescription")}</p>
    </div></article>
    <For each={query.data?.environments}>{(environment) => <article aria-label={environment.id} class={appearance.root()}>
      <div class={appearance.body({ class: "flex flex-col gap-3" })}>
        <h3 class="text-13-medium">{environment.id}</h3>
        <p>{environment.repository}</p>
        <p>{language.t("environments.status", { state: language.t(`environments.state.${environment.state}`), phase: language.t(`environments.phase.${environment.phase}`) })}</p>
        <p>{language.t("environments.limits", { cpu: environment.cpu, memory: environment.memoryMiB })}</p>
        <Show when={environment.commit}><p>{language.t("environments.commit", { commit: environment.commit! })}</p></Show>
        <p class="text-ink-muted">{language.t("environments.lifecycle")}</p>
        <Show when={environment.state === "failed" || environment.state === "reconcile"}><p role="status">{language.t("environments.reconcile")}</p></Show>
        <Show when={environment.state === "failed" || environment.state === "reconcile"}>
          <Button variant="outline" disabled={state.busy} onClick={() => setState({ id: `${environment.id.slice(0, 50)}-${crypto.randomUUID().slice(0, 8)}`,
            repository: environment.repository, ref: environment.commit ?? environment.ref, image: environment.image, cpu: environment.cpu,
            memoryMiB: environment.memoryMiB, setup: "", key: "", provider: "", notice: language.t("environments.anotherDescription") })}>
            {language.t("environments.another")}</Button>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" disabled={state.busy || environment.state !== "ready"} onClick={() => void action(async () => {
            const coordinator = servers.visible.find((server) => ServerConnection.key(server) === state.coordinator)
            if (!coordinator) throw new Error(language.t("environments.coordinatorUnavailable"))
            if (ServerConnection.key(coordinator) === ServerConnection.key(props.server))
              await api().register({ id: environment.id, ...(state.resourceID.trim() ? { resourceID: state.resourceID.trim() } : {}) })
            else {
              if (!props.server.http.password) throw new Error(language.t("environments.remoteCredential"))
              const local = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)
              if (local(props.server.http.url) && (coordinator.type === "extension" || !local(coordinator.http.url))) throw new Error(language.t("agentMachines.routeUnavailable"))
              await global.ensureServerCtx(coordinator).sdk.api.workers.add({ id: environment.id, url: props.server.http.url,
                password: props.server.http.password, directories: [environment.directory], tags: ["isolated"],
                environmentID: environment.id, environmentProxy: true,
                ...(state.resourceID.trim() ? { resourceID: state.resourceID.trim() } : {}),
              })
            }
            if (lifetime.active) { setState("notice", language.t("environments.registered")); setParams({ view: "remote", host: state.coordinator }) }
          })}>{language.t("environments.register")}</Button>
          <Button variant="outline" disabled={state.busy || !["stopped", "archived", "reconcile"].includes(environment.state) || environment.phase !== "complete"}
            onClick={() => void action(() => api().start({ id: environment.id }))}>{language.t("environments.start")}</Button>
          <Button variant="outline" disabled={state.busy || !["ready", "failed", "reconcile"].includes(environment.state)}
            onClick={() => void action(() => api().stop({ id: environment.id }))}>{language.t("environments.stop")}</Button>
          <Button variant="outline" disabled={state.busy || environment.state !== "stopped"}
            onClick={() => void action(() => api().remove({ id: environment.id, purge: false }))}>{language.t("environments.archive")}</Button>
          <Button variant="ghost" disabled={state.busy || !["stopped", "archived"].includes(environment.state)}
            onClick={() => setState("confirm", environment.id)}>{language.t("environments.delete")}</Button>
        </div>
        <Show when={state.confirm === environment.id}>
          <p>{language.t("environments.deleteDescription")}</p>
          <Button disabled={state.busy} onClick={() => void action(async () => { await api().remove({ id: environment.id, purge: true }); if (lifetime.active) setState("confirm", "") })}>
            {language.t("environments.confirmDelete")}</Button>
          <Button variant="ghost" disabled={state.busy} onClick={() => setState("confirm", "")}>{language.t("common.cancel")}</Button>
        </Show>
      </div>
    </article>}</For>
    <Show when={query.data?.environments.length === 0}><p role="status">{language.t("environments.empty")}</p></Show>
  </div>
}
