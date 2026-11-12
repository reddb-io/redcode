import { createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  ServerCreatorPluginCreatorPluginInstallOutput,
  ServerCreatorPluginCreatorPluginReviewOutput,
} from "@opencode/client/promise"
import type { LocationRef } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { SearchSelect } from "@opencode/ui/search-select"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { createKeyed, createLatest, useExtension, type ServerRef, type SessionRef } from "../sdk"
import type definition from "./index"
import TryPlugin from "./try-plugin"

type PluginInfo = ServerCreatorPluginCreatorPluginInstallOutput["data"]

export default function Plugins(props: { server?: ServerRef; location?: LocationRef; session?: SessionRef }) {
  const ctx = useExtension<typeof definition>()
  const scope = createMemo(
    () =>
      props.server?.connected && props.location
        ? { server: props.server, client: props.server.client, location: props.location }
        : undefined,
    undefined,
    {
      equals: (a, b) =>
        a?.client === b?.client &&
        a?.location.directory === b?.location.directory &&
        a?.location.workspaceID === b?.location.workspaceID,
    },
  )
  return (
    <section data-slot="creator-plugins" class="my-3 rounded-lg border border-elevation-base-border">
      <div class="border-b border-elevation-base-border px-3 py-2">
        <h3 class="text-13-medium text-foreground">{ctx.t("plugins.title")}</h3>
        <p class="mt-1 text-12-regular text-ink-muted">{ctx.t("plugins.description")}</p>
      </div>
      <Show when={props.location} fallback={<p class="p-3 text-12-regular text-ink-muted">{ctx.t("plugins.scope")}</p>}>
        <Show
          when={scope()}
          keyed
          fallback={
            <p role="status" class="p-3 text-12-regular text-ink-muted">
              {ctx.t("server.unavailable")}
            </p>
          }
        >
          {(input) => <Library server={input.server} location={input.location} session={props.session} />}
        </Show>
      </Show>
    </section>
  )
}

function Library(props: { server: ServerRef; location: LocationRef; session?: SessionRef }) {
  const ctx = useExtension<typeof definition>()
  const api = () => props.server.client["server.creatorPlugin"].creator.plugin
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({ refresh: 0, search: "", pending: "", error: "", installing: false })
  const refresh = () => setState("refresh", (value) => value + 1)
  const inventory = createLatest(
    () => state.refresh,
    (_, signal) => api().list({ location: props.location }, { signal }),
  )
  const filtered = createMemo(() =>
    (inventory.latest?.data ?? []).filter((item) =>
      `${item.name} ${item.packageName}`.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()),
    ),
  )
  createKeyed(
    () => props.server.data,
    (data) => {
      const update = (event: { location?: LocationRef }) => {
        if (
          event.location?.directory === props.location.directory &&
          event.location.workspaceID === props.location.workspaceID
        )
          refresh()
      }
      onCleanup(data.on("creator.plugin.updated", update))
      onCleanup(data.on("plugin.updated", update))
    },
  )
  const perform = (id: string, task: (signal: AbortSignal) => Promise<unknown>) => {
    if (state.pending || controller.signal.aborted) return
    setState({ pending: id, error: "" })
    void task(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) refresh()
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState("error", message(error))
          refresh()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setState("pending", "")
      })
  }
  const remove = (item: PluginInfo) =>
    ctx.dialogs.open((dialog) => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={ctx.t("plugins.remove.title", { name: item.name })}
            description={ctx.t("plugins.remove.description")}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {ctx.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dialog.close()
              perform(item.id, (signal) =>
                api().remove(
                  { pluginID: item.id, expectedVersion: item.version, location: props.location },
                  { signal },
                ),
              )
            }}
          >
            {ctx.t("plugins.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  return (
    <div class="space-y-3 p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-11-regular text-ink-muted" title={props.location.directory}>
          {ctx.t("plugins.host", { server: props.server.name, directory: props.location.directory })}
        </span>
        <div class="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={refresh} disabled={inventory.loading}>
            {ctx.t("plugins.refresh")}
          </Button>
          <Button
            variant="outline"
            disabled={state.installing || !!state.pending || !!inventory.error}
            onClick={() => setState("installing", true)}
          >
            {ctx.t("plugins.install")}
          </Button>
        </div>
      </div>
      <Show when={state.error || inventory.error}>
        <p role="alert" class="break-words text-12-regular text-text-danger-base">
          {state.error || `${ctx.t("plugins.unavailable")} ${message(inventory.error)}`}
        </p>
      </Show>
      <Show when={state.installing}>
        <Installer
          server={props.server}
          location={props.location}
          close={() => {
            setState("installing", false)
            refresh()
          }}
        />
      </Show>
      <Show when={inventory.loading && !inventory.latest}>
        <p role="status" class="text-12-regular text-ink-muted">
          {ctx.t("plugins.loading")}
        </p>
      </Show>
      <Show
        when={inventory.latest?.data.length}
        fallback={
          <Show when={!inventory.loading && !inventory.error}>
            <p class="text-12-regular text-ink-muted">{ctx.t("plugins.empty")}</p>
          </Show>
        }
      >
        <TextField
          label={ctx.t("plugins.search")}
          hideLabel
          placeholder={ctx.t("plugins.search")}
          value={state.search}
          onChange={(value) => setState("search", value)}
        />
        <Show when={!filtered().length}>
          <p class="text-12-regular text-ink-muted">{ctx.t("search.empty")}</p>
        </Show>
        <For each={filtered()}>
          {(item) => (
            <article class="rounded-md border border-elevation-base-border px-3 py-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-13-medium text-foreground">{item.name}</p>
                  <p class="truncate font-mono text-11-regular text-ink-muted">
                    {item.packageName}@{item.packageVersion}
                  </p>
                </div>
                <span role="status" class="rounded bg-elevation-raised-surface px-2 py-1 text-11-medium text-ink-muted">
                  {ctx.t(`plugins.state.${item.runtime}`)}
                </span>
                <Button
                  variant="ghost"
                  disabled={!!state.pending || item.enabled}
                  onClick={() =>
                    perform(item.id, (signal) =>
                      api().test(
                        { pluginID: item.id, expectedVersion: item.version, location: props.location },
                        { signal },
                      ),
                    )
                  }
                >
                  {ctx.t(state.pending === item.id ? "plugins.working" : "plugins.test")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!state.pending || (!item.enabled && !item.report?.passed)}
                  onClick={() =>
                    perform(item.id, (signal) =>
                      api().control(
                        {
                          pluginID: item.id,
                          expectedVersion: item.version,
                          enabled: !item.enabled,
                          location: props.location,
                        },
                        { signal },
                      ),
                    )
                  }
                >
                  {ctx.t(item.enabled ? "plugins.disable" : "plugins.activate")}
                </Button>
                <Button variant="ghost" disabled={!!state.pending} onClick={() => remove(item)}>
                  {ctx.t("plugins.remove")}
                </Button>
                <Show when={props.session && item.runtime === "active" && item.report?.tools.length}>
                  <Button
                    variant="ghost"
                    disabled={!!state.pending}
                    onClick={() => {
                      const session = props.session
                      if (!session) return
                      ctx.dialogs.open((dialog) => (
                        <TryPlugin
                          session={session}
                          name={item.name}
                          tools={item.report?.tools ?? []}
                          close={() => dialog.close()}
                        />
                      ))
                    }}
                  >
                    {ctx.t("plugins.try")}
                  </Button>
                </Show>
              </div>
              <p class="mt-1 truncate font-mono text-11-regular text-ink-muted" title={item.revision}>
                {ctx.t("plugins.origin", { revision: item.revision, entry: item.entry })}
              </p>
              <Show when={item.error}>
                <p role="alert" class="mt-2 break-words text-12-regular text-text-danger-base">
                  {item.error}
                </p>
              </Show>
              <Show when={item.report}>
                {(report) => (
                  <details class="mt-2 text-12-regular text-ink-muted">
                    <summary class="cursor-pointer">
                      {ctx.t(report().passed ? "plugins.test.passed" : "plugins.test.failed")}
                    </summary>
                    <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-11-regular">{report().message}</pre>
                    <Show when={report().tools.length}>
                      <p class="mt-1">{ctx.t("plugins.tools", { tools: report().tools.join(", ") })}</p>
                    </Show>
                  </details>
                )}
              </Show>
            </article>
          )}
        </For>
      </Show>
    </div>
  )
}

function Installer(props: { server: ServerRef; location: LocationRef; close: () => void }) {
  const ctx = useExtension<typeof definition>()
  const api = () => props.server.client["server.creatorPlugin"].creator.plugin
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({
    selected: "",
    refresh: 0,
    pending: false,
    error: "",
    review: undefined as ServerCreatorPluginCreatorPluginReviewOutput["data"] | undefined,
    installed: undefined as PluginInfo | undefined,
  })
  const candidates = createLatest(
    () => state.refresh,
    (_, signal) => api().candidates({ location: props.location }, { signal }),
  )
  // A completed generation can publish a package while this installer is already open.
  createKeyed(
    () => props.server.data,
    (data) =>
      onCleanup(
        data.on("session.execution.succeeded", (event) => {
          if (
            event.location?.directory === props.location.directory &&
            event.location.workspaceID === props.location.workspaceID
          )
            setState("refresh", (value) => value + 1)
        }),
      ),
  )
  const selected = () => candidates.latest?.data.find((item) => item.designID === state.selected)
  const perform = (task: () => Promise<void>) => {
    if (state.pending || controller.signal.aborted) return
    setState({ pending: true, error: "" })
    void task()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState("error", message(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setState("pending", false)
      })
  }
  const review = () =>
    perform(async () => {
      const item = selected()
      if (!item) return
      const result = await api().review({ ...item, location: props.location }, { signal: controller.signal })
      if (!controller.signal.aborted) setState("review", result.data)
    })
  const install = (runTest = false) =>
    perform(async () => {
      const item = state.review
      if (!item) return
      const result = await api().install({ ...item, location: props.location }, { signal: controller.signal })
      if (controller.signal.aborted) return
      setState("installed", result.data)
      if (!runTest) return
      const tested = await api().test(
        { pluginID: result.data.id, expectedVersion: result.data.version, location: props.location },
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) setState("installed", tested.data)
    })
  const test = () =>
    perform(async () => {
      const item = state.installed
      if (!item) return
      const result = await api().test(
        { pluginID: item.id, expectedVersion: item.version, location: props.location },
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) setState("installed", result.data)
    })
  const activate = () =>
    perform(async () => {
      const item = state.installed
      if (!item?.report?.passed) return
      await api().control(
        { pluginID: item.id, expectedVersion: item.version, enabled: true, location: props.location },
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) props.close()
    })
  return (
    <div
      data-slot="creator-plugin-installer"
      class="space-y-3 rounded-md border border-elevation-base-border bg-elevation-raised-surface p-3"
    >
      <p class="text-13-medium text-foreground">
        {ctx.t(state.installed ? "plugins.step.test" : state.review ? "plugins.step.review" : "plugins.step.choose")}
      </p>
      <Show when={!state.review}>
        <SearchSelect
          label={ctx.t("plugins.source")}
          placeholder={ctx.t("plugins.source")}
          options={(candidates.latest?.data ?? []).map((item) => ({
            value: item.designID,
            label: item.name,
            description: item.revision,
          }))}
          value={state.selected}
          onChange={(value) => setState("selected", value)}
          disabled={state.pending}
        />
        <Show when={!candidates.loading && !candidates.error && !candidates.latest?.data.length}>
          <p class="text-12-regular text-ink-muted">{ctx.t("plugins.source.empty")}</p>
        </Show>
        <Button
          variant="ghost"
          disabled={candidates.loading || state.pending}
          onClick={() => setState("refresh", (value) => value + 1)}
        >
          {ctx.t("plugins.sources.refresh")}
        </Button>
      </Show>
      <Show when={state.review}>
        {(item) => (
          <div class="space-y-1 text-12-regular text-ink-muted">
            <p class="font-mono text-foreground">
              {item().packageName}@{item().packageVersion}
            </p>
            <p>{ctx.t("plugins.origin", { revision: item().revision, entry: item().entry })}</p>
            <p>
              {ctx.t("plugins.capabilities", { capabilities: item().capabilities.join(", ") || ctx.t("plugins.none") })}
            </p>
            <details>
              <summary class="cursor-pointer">
                {ctx.t("plugins.package", { count: item().files.length, bytes: item().bytes.toLocaleString() })}
              </summary>
              <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-11-regular">
                {item().files.join("\n")}
              </pre>
            </details>
            <Show when={item().dependencies.length}>
              <p>{ctx.t("plugins.dependencies", { dependencies: item().dependencies.join(", ") })}</p>
            </Show>
            <p>{ctx.t("plugins.trust", { server: props.server.name })}</p>
          </div>
        )}
      </Show>
      <Show when={state.installed?.report}>
        {(report) => (
          <div role="status" class="text-12-regular text-ink-muted">
            <p class="text-12-medium">{ctx.t(report().passed ? "plugins.test.passed" : "plugins.test.failed")}</p>
            <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-11-regular">{report().message}</pre>
          </div>
        )}
      </Show>
      <Show when={state.error || candidates.error}>
        <p role="alert" class="break-words text-12-regular text-text-danger-base">
          {state.error || message(candidates.error)}
        </p>
      </Show>
      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" disabled={state.pending} onClick={() => props.close()}>
          {ctx.t(state.installed ? "plugins.close" : "common.cancel")}
        </Button>
        <Show when={!state.review}>
          <Button variant="outline" disabled={!selected() || state.pending} onClick={review}>
            {ctx.t("plugins.review")}
          </Button>
        </Show>
        <Show when={state.review && !state.installed}>
          <Button variant="ghost" disabled={state.pending} onClick={() => install()}>
            {ctx.t("plugins.install.disabled")}
          </Button>
          <Button variant="submit" disabled={state.pending} onClick={() => install(true)}>
            {ctx.t(state.pending ? "plugins.working" : "plugins.install.test")}
          </Button>
        </Show>
        <Show when={state.installed}>
          <Button variant="outline" disabled={state.pending || state.installed?.enabled} onClick={test}>
            {ctx.t(state.pending ? "plugins.working" : "plugins.test")}
          </Button>
          <Button variant="submit" disabled={state.pending || !state.installed?.report?.passed} onClick={activate}>
            {ctx.t("plugins.activate")}
          </Button>
        </Show>
      </div>
    </div>
  )
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
