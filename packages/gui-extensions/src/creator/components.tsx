import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Option, Schema } from "effect"
import type { CreatorComponentInfo, LocationRef } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { SearchSelect } from "@opencode/ui/search-select"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { Tooltip } from "@opencode/ui/tooltip"
import { createKeyed, createLatest, useExtension, type ServerRef } from "../sdk"
import type definition from "./index"

type Props = {
  server?: ServerRef
  location?: LocationRef
  sessionID?: string
  visible: boolean
}

const RuntimeError = Schema.Struct({
  type: Schema.Literal("redcode:creator-error"),
  message: Schema.String,
  stack: Schema.optional(Schema.String),
})
const decodeRuntimeError = Schema.decodeUnknownOption(RuntimeError)

export default function Components(props: Props) {
  const ctx = useExtension<typeof definition>()
  // A new server controller or project owns a fresh library, its requests and its iframe.
  const scope = createMemo(
    () =>
      props.server?.connected && props.location
        ? { client: props.server.client, server: props.server, location: props.location }
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
    <div class="flex size-full min-h-0 flex-col bg-elevation-base-surface" data-slot="creator-components">
      <div class="border-b border-elevation-base-border px-3 py-2">
        <h3 class="text-13-medium text-foreground">{ctx.t("title")}</h3>
        <p class="mt-1 text-12-regular text-ink-muted">{ctx.t("description")}</p>
      </div>
      <Show
        when={props.location}
        fallback={<p class="px-3 py-3 text-12-regular text-ink-muted">{ctx.t("scope.missing")}</p>}
      >
        <Show
          when={scope()}
          keyed
          fallback={
            <p role="status" class="px-3 py-3 text-12-regular text-ink-muted">
              {ctx.t("server.unavailable")}
            </p>
          }
        >
          {(input) => (
            <Library
              server={input.server}
              location={input.location}
              sessionID={props.sessionID}
              visible={props.visible}
            />
          )}
        </Show>
      </Show>
    </div>
  )
}

function Library(props: { server: ServerRef; location: LocationRef; sessionID?: string; visible: boolean }) {
  const ctx = useExtension<typeof definition>()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({ refresh: 0, search: "", selected: "", pending: "", error: "", notice: "" })
  const source = createMemo(() => (props.visible ? String(state.refresh) : undefined))
  const inventory = createLatest(source, (_, signal) =>
    props.server.client["server.creatorComponent"].creator.component.list({ location: props.location }, { signal }),
  )
  const items = () => inventory.latest?.data ?? []
  const filtered = createMemo(() => {
    const query = state.search.trim().toLocaleLowerCase()
    return items().filter((item) => `${item.name} ${item.description ?? ""}`.toLocaleLowerCase().includes(query))
  })
  const selected = createMemo(() => items().find((item) => item.id === state.selected))
  const refresh = () => setState("refresh", (value) => value + 1)

  // Listen only while this surface is visible; reopening takes a fresh authoritative inventory.
  createKeyed(
    () => (props.visible ? props.server.data : undefined),
    (data) =>
      onCleanup(
        data.on("creator.component.updated", (event) => {
          if (
            event.location?.directory !== props.location.directory ||
            event.location.workspaceID !== props.location.workspaceID
          )
            return
          refresh()
        }),
      ),
  )

  const perform = (id: string, task: (signal: AbortSignal) => Promise<void>) => {
    if (state.pending) return
    setState({ pending: id, error: "", notice: "" })
    void task(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) refresh()
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState("error", error instanceof Error ? error.message : ctx.t("request.failed"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setState("pending", "")
      })
  }
  const toggle = (item: CreatorComponentInfo) =>
    perform(item.id, async (signal) => {
      await props.server.client["server.creatorComponent"].creator.component.control(
        { componentID: item.id, expectedVersion: item.version, enabled: !item.enabled, location: props.location },
        { signal },
      )
    })
  const update = (item: CreatorComponentInfo) =>
    perform(item.id, async (signal) => {
      const designs = await props.server.client.session.design.list({ sessionID: item.sessionID }, { signal })
      if (signal.aborted) return
      const revision = designs.find((design) => design.id === item.designID)?.revision
      if (!revision) throw new Error(ctx.t("source.missing"))
      if (revision === item.revision) {
        setState("notice", ctx.t("update.none"))
        return
      }
      await props.server.client["server.creatorComponent"].creator.component.update(
        { componentID: item.id, expectedVersion: item.version, revision, location: props.location },
        { signal },
      )
    })
  const remove = (item: CreatorComponentInfo) => {
    ctx.dialogs.open((dialog) => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={ctx.t("remove.title", { name: item.name })}
            description={ctx.t("remove.description")}
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
              perform(item.id, async (signal) => {
                await props.server.client["server.creatorComponent"].creator.component.remove(
                  { componentID: item.id, expectedVersion: item.version, location: props.location },
                  { signal },
                )
                if (!signal.aborted && state.selected === item.id) setState("selected", "")
              })
            }}
          >
            {ctx.t("remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }
  const install = () => {
    const sessionID = props.sessionID
    if (!sessionID) return
    ctx.dialogs.open((dialog) => (
      <Install
        server={props.server}
        location={props.location}
        sessionID={sessionID}
        close={() => dialog.close()}
        installed={(item) => {
          if (controller.signal.aborted) return
          setState({ selected: item.id, search: "" })
          refresh()
        }}
      />
    ))
  }

  return (
    <>
      <div class="flex items-center justify-between gap-2 border-b border-elevation-base-border px-3 py-2">
        <span class="min-w-0 truncate text-11-regular text-ink-muted" title={props.location.directory}>
          {ctx.t("scope", { directory: props.location.directory })}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip value={ctx.t("refresh")}>
            <IconButton
              icon={<Icon name="refresh" size="small" />}
              aria-label={ctx.t("refresh")}
              onClick={refresh}
              disabled={inventory.loading}
            />
          </Tooltip>
          <Show when={props.sessionID}>
            <Button variant="ghost" onClick={install} disabled={!!state.pending}>
              {ctx.t("install")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={state.error || inventory.error}>
        <div role="alert" class="border-b border-elevation-base-border px-3 py-2 text-12-regular text-text-danger-base">
          <p>{state.error || ctx.t("request.unavailable")}</p>
          <Show when={inventory.error}>
            <p class="mt-1 break-words">
              {inventory.error instanceof Error ? inventory.error.message : ctx.t("request.failed")}
            </p>
          </Show>
        </div>
      </Show>
      <Show when={state.notice}>
        <p role="status" class="px-3 py-2 text-12-regular text-ink-muted">
          {state.notice}
        </p>
      </Show>
      <Show
        when={selected()}
        fallback={
          <div class="min-h-0 flex-1 overflow-auto px-3 py-2">
            <Show when={items().length}>
              <TextField
                label={ctx.t("search")}
                hideLabel
                placeholder={ctx.t("search")}
                value={state.search}
                onChange={(value) => setState("search", value)}
              />
            </Show>
            <Show when={inventory.loading && !inventory.latest}>
              <p role="status" class="py-2 text-12-regular text-ink-muted">
                {ctx.t("loading")}
              </p>
            </Show>
            <Show when={inventory.latest && !items().length}>
              <p class="py-2 text-12-medium text-foreground">{ctx.t("empty")}</p>
              <p class="text-12-regular text-ink-muted">{ctx.t("empty.description")}</p>
            </Show>
            <Show when={items().length && !filtered().length}>
              <p class="py-2 text-12-regular text-ink-muted">{ctx.t("search.empty")}</p>
            </Show>
            <For each={filtered()}>
              {(item) => (
                <div class="flex min-h-14 items-center gap-2 border-b border-elevation-base-border py-2">
                  <button class="min-w-0 flex-1 text-left" onClick={() => setState("selected", item.id)}>
                    <span class="block truncate text-12-medium text-foreground">{item.name}</span>
                    <span class="block truncate font-mono text-11-regular text-ink-muted">
                      {ctx.t("revision", { revision: item.revision, version: item.version })}
                    </span>
                    <Show when={item.description}>
                      <span class="block truncate text-12-regular text-ink-muted">{item.description}</span>
                    </Show>
                  </button>
                  <Switch checked={item.enabled} onChange={() => toggle(item)} disabled={!!state.pending} hideLabel>
                    {ctx.t("toggle.label", { name: item.name })}
                  </Switch>
                  <Tooltip value={ctx.t("update")}>
                    <IconButton
                      icon={<Icon name="refresh" size="small" />}
                      aria-label={ctx.t("update")}
                      onClick={() => update(item)}
                      disabled={!!state.pending}
                    />
                  </Tooltip>
                  <Tooltip value={ctx.t("remove")}>
                    <IconButton
                      icon={<Icon name="trash" size="small" />}
                      aria-label={ctx.t("remove")}
                      onClick={() => remove(item)}
                      disabled={!!state.pending}
                    />
                  </Tooltip>
                </div>
              )}
            </For>
          </div>
        }
      >
        {(item) => (
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex items-center gap-2 border-b border-elevation-base-border px-3 py-2">
              <IconButton
                icon={<Icon name="outline-arrow-left" size="small" />}
                aria-label={ctx.t("preview.back")}
                onClick={() => setState("selected", "")}
              />
              <span class="min-w-0 flex-1 truncate text-12-medium text-foreground">{item().name}</span>
              <Switch checked={item().enabled} onChange={() => toggle(item())} disabled={!!state.pending} hideLabel>
                {ctx.t("toggle.label", { name: item().name })}
              </Switch>
              <Tooltip value={ctx.t("update")}>
                <IconButton
                  icon={<Icon name="refresh" size="small" />}
                  aria-label={ctx.t("update")}
                  onClick={() => update(item())}
                  disabled={!!state.pending}
                />
              </Tooltip>
              <IconButton
                icon={<Icon name="trash" size="small" />}
                aria-label={ctx.t("remove")}
                onClick={() => remove(item())}
                disabled={!!state.pending}
              />
            </div>
            <Show
              when={item().enabled}
              fallback={<p class="px-3 py-3 text-12-regular text-ink-muted">{ctx.t("preview.disabled")}</p>}
            >
              <Show when={props.visible}>
                <Preview server={props.server} location={props.location} component={item()} />
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </>
  )
}

function Preview(props: { server: ServerRef; location: LocationRef; component: CreatorComponentInfo }) {
  const ctx = useExtension<typeof definition>()
  const [reload, setReload] = createSignal(0)
  const source = createMemo(
    () => ({ id: props.component.id, version: props.component.version, reload: reload() }),
    undefined,
    {
      equals: (a, b) => a?.id === b?.id && a?.version === b?.version && a?.reload === b?.reload,
    },
  )
  const result = createLatest(source, (input, signal) =>
    props.server.client["server.creatorComponent"].creator.component.preview(
      { componentID: input.id, location: props.location },
      { signal },
    ),
  )
  return (
    <div class="flex min-h-80 flex-1 flex-col">
      <div class="flex items-center justify-between px-3 py-1 text-11-regular text-ink-muted">
        <span>{ctx.t("revision", { revision: props.component.revision, version: props.component.version })}</span>
        <IconButton
          icon={<Icon name="refresh" size="small" />}
          aria-label={ctx.t("preview.refresh")}
          onClick={() => setReload((value) => value + 1)}
        />
      </div>
      <Show when={result.error}>
        <p role="alert" class="px-3 py-2 text-12-regular text-text-danger-base">
          {ctx.t("preview.failed")}: {result.error instanceof Error ? result.error.message : ctx.t("request.failed")}
        </p>
      </Show>
      <Show when={result.loading}>
        <p role="status" class="px-3 py-2 text-12-regular text-ink-muted">
          {ctx.t("preview.loading")}
        </p>
      </Show>
      <Show when={!result.loading && !result.error && result.latest?.data} keyed>
        {(preview) => <RuntimeFrame html={preview.html} name={props.component.name} />}
      </Show>
    </div>
  )
}

function RuntimeFrame(props: { html: string; name: string; ready?: () => void; failed?: () => void }) {
  const ctx = useExtension<typeof definition>()
  const [diagnostic, setDiagnostic] = createStore({ message: "", stack: "" })
  let frame: HTMLIFrameElement | undefined
  const report = (event: MessageEvent<unknown>) => {
    if (event.source !== frame?.contentWindow || event.origin !== "null") return
    const error = decodeRuntimeError(event.data)
    if (Option.isNone(error)) return
    setDiagnostic({ message: error.value.message, stack: error.value.stack ?? "" })
    props.failed?.()
  }
  window.addEventListener("message", report)
  onCleanup(() => window.removeEventListener("message", report))
  return (
    <>
      <Show when={diagnostic.message}>
        <div role="alert" class="border-y border-elevation-base-border px-3 py-2 text-12-regular text-text-danger-base">
          <p class="text-12-medium">{ctx.t("preview.runtime.failed")}</p>
          <p class="mt-1 break-words">{diagnostic.message}</p>
          <Show when={diagnostic.stack}>
            <details class="mt-1">
              <summary>{ctx.t("preview.runtime.details")}</summary>
              <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-11-regular">{diagnostic.stack}</pre>
            </details>
          </Show>
        </div>
      </Show>
      <iframe
        ref={frame}
        title={ctx.t("preview.frame", { name: props.name })}
        srcdoc={props.html}
        onLoad={() => {
          if (!diagnostic.message) props.ready?.()
        }}
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        class="min-h-80 w-full flex-1 border-0"
      />
    </>
  )
}

function Install(props: {
  server: ServerRef
  location: LocationRef
  sessionID: string
  close: () => void
  installed: (item: CreatorComponentInfo) => void
}) {
  const ctx = useExtension<typeof definition>()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [state, setState] = createStore({
    design: "",
    name: "",
    saving: false,
    testing: false,
    refresh: 0,
    ready: false,
    error: "",
    tested: undefined as { html: string; revision: string } | undefined,
  })
  const designs = createLatest(
    () => `${props.sessionID}:${state.refresh}`,
    (_, signal) => props.server.client.session.design.list({ sessionID: props.sessionID }, { signal }),
  )
  // Refresh published choices when the owning conversation finishes generation, without polling.
  createKeyed(
    () => props.server.data,
    (data) =>
      onCleanup(
        data.on("session.execution.succeeded", (event) => {
          if (event.data.sessionID === props.sessionID) setState("refresh", (value) => value + 1)
        }),
      ),
  )
  const options = createMemo(() =>
    (designs.latest ?? [])
      .filter((item) => item.revision && item.collaboration?.contracts?.creator?.kind !== "extension")
      .map((item) => ({ value: item.id, label: item.name, description: item.revision ?? undefined })),
  )
  const selected = createMemo(() => designs.latest?.find((item) => item.id === state.design))
  const test = async () => {
    const design = selected()
    if (!design?.revision || state.testing || state.saving) return
    setState({ testing: true, ready: false, tested: undefined, error: "" })
    try {
      const result = await props.server.client["server.creatorComponent"].creator.component.test(
        {
          sessionID: props.sessionID,
          designID: design.id,
          revision: design.revision,
          name: state.name.trim() || design.name,
          location: props.location,
        },
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) setState("tested", result.data)
    } catch (error) {
      if (!controller.signal.aborted)
        setState(
          "error",
          `${ctx.t("install.test.failed")} ${error instanceof Error ? error.message : ctx.t("request.failed")}`,
        )
    } finally {
      if (!controller.signal.aborted) setState("testing", false)
    }
  }
  const save = () => {
    const design = selected()
    if (
      !design?.revision ||
      state.tested?.revision !== design.revision ||
      !state.ready ||
      !state.name.trim() ||
      state.saving
    )
      return
    setState({ saving: true, error: "" })
    void props.server.client["server.creatorComponent"].creator.component
      .install(
        {
          sessionID: props.sessionID,
          designID: design.id,
          revision: design.revision,
          name: state.name.trim(),
          location: props.location,
        },
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted) return
        props.installed(result.data)
        props.close()
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ saving: false, error: error instanceof Error ? error.message : ctx.t("request.failed") })
      })
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("install")} description={ctx.t("install.description")} />
      </DialogHeader>
      <div class="flex flex-col gap-3 px-6 pb-4">
        <SearchSelect
          label={ctx.t("install.source")}
          placeholder={ctx.t("install.source")}
          options={options()}
          value={state.design}
          onChange={(value) =>
            setState({
              design: value,
              name: designs.latest?.find((item) => item.id === value)?.name ?? "",
              tested: undefined,
              ready: false,
              error: "",
            })
          }
          disabled={state.saving || state.testing}
        />
        <Show when={!designs.loading && !options().length}>
          <p class="text-12-regular text-ink-muted">{ctx.t("install.source.empty")}</p>
        </Show>
        <Button
          variant="ghost"
          disabled={designs.loading || state.testing || state.saving}
          onClick={() => setState("refresh", (value) => value + 1)}
        >
          {ctx.t("install.sources.refresh")}
        </Button>
        <TextField
          label={ctx.t("install.name")}
          value={state.name}
          onChange={(value) => setState("name", value)}
          disabled={state.saving}
        />
        <Show when={state.error || designs.error}>
          <p role="alert" class="text-12-regular text-text-danger-base">
            {state.error || (designs.error instanceof Error ? designs.error.message : ctx.t("request.failed"))}
          </p>
        </Show>
        <p class="text-12-regular text-ink-muted">{ctx.t("install.test.description")}</p>
        <Show when={state.tested} keyed>
          {(tested) => (
            <div class="flex max-h-96 min-h-64 flex-col overflow-auto rounded-md border border-elevation-base-border">
              <RuntimeFrame
                html={tested.html}
                name={state.name}
                ready={() => setState("ready", true)}
                failed={() => setState("ready", false)}
              />
            </div>
          )}
        </Show>
        <Show when={state.ready}>
          <p role="status" class="text-12-regular text-ink-muted">
            {ctx.t("install.test.ready")}
          </p>
        </Show>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.close()}>
          {ctx.t("common.cancel")}
        </Button>
        <Button
          variant="outline"
          disabled={!selected()?.revision || state.saving || state.testing}
          onClick={() => void test()}
        >
          {ctx.t(state.testing ? "install.test.pending" : "install.test")}
        </Button>
        <Button
          variant="submit"
          disabled={
            !selected()?.revision ||
            !state.name.trim() ||
            state.saving ||
            state.testing ||
            !state.ready ||
            state.tested?.revision !== selected()?.revision
          }
          onClick={save}
        >
          {ctx.t("install")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
