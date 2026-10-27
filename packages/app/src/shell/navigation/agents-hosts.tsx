import type { HostResourcesSnapshot } from "@opencode/client/promise"
import { input } from "@reddb-io/design-system/contracts/input"
import { listRow } from "@reddb-io/design-system/contracts/list-row"
import { sidebarPanel } from "@reddb-io/design-system/contracts/sidebar-panel"
import { multiColumnLayout } from "@reddb-io/design-system/contracts/multi-column-layout"
import { searchSelectOptions } from "@reddb-io/design-system/contracts/search-select"
import { statusIndicator } from "@reddb-io/design-system/contracts/status-indicator"
import { Button } from "@opencode/ui/button"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { ReactView } from "@/runtime/react/view"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { HostHistory } from "./host-history.react"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useNavigation } from "./controller"

export default function AgentHosts(props: { server: ServerConnection.Any }) {
  const global = useGlobal()
  const ctx = () => global.ensureServerCtx(props.server)
  const language = useLanguage()
  const navigation = useNavigation()
  const [state, setState] = createStore({ selected: "", open: false, search: "" })
  let opener: HTMLButtonElement | undefined
  let inspector: HTMLElement | undefined
  const panel = sidebarPanel()
  const columns = multiColumnLayout()
  const inspected = () => !navigation.mobile() || state.open
  const connected = () => ctx().sdk.connection.status() === "connected"
  const workers = useQuery(() => ({
    queryKey: ["remote-workers", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => ctx().sdk.api.workers.list({ signal }),
    enabled: connected(),
    retry: false,
    refetchInterval: 5000,
  }))
  const hosts = createMemo(() => [
    {
      id: "",
      name: language.t("agents.hosts.coordinator"),
      description: props.server.http.url,
      keywords: [] as string[],
      connection: connected() ? ("online" as const) : ("offline" as const),
    },
    ...(workers.data?.workers ?? []).flatMap((status) =>
      status.worker.kind === "local"
        ? []
        : [
            {
              id: status.worker.id,
              name: status.worker.id,
              description: status.worker.directories.join(" · "),
              keywords: [status.worker.url, ...status.worker.tags],
              connection:
                connected() && !workers.isError && workers.data?.available ? status.connection : ("unchecked" as const),
            },
          ],
    ),
  ])
  const filtered = createMemo(() => {
    const found = new Set(
      searchSelectOptions(
        hosts().map((host) => ({
          value: host.id,
          label: host.name,
          description: host.description,
          keywords: host.keywords,
        })),
        state.search,
      ).map((option) => option.value),
    )
    return hosts().filter((host) => found.has(host.id))
  })
  const selected = () => hosts().find((host) => host.id === state.selected)
  createEffect(
    on(
      [() => state.selected, () => state.open, navigation.mobile],
      () => {
        if (!inspected()) return
        queueMicrotask(() => {
          inspector?.focus({ preventScroll: true })
          inspector?.scrollIntoView({ block: "nearest" })
        })
      },
      { defer: true },
    ),
  )
  const back = () => {
    setState("open", false)
    queueMicrotask(() => {
      if (!opener?.isConnected) return
      opener.focus({ preventScroll: true })
      opener.scrollIntoView({ block: "nearest" })
    })
  }
  return (
    <div class={columns.root()}>
      <div hidden={navigation.mobile() && state.open} class={columns.start({ class: columns.column() })}>
        <label class="flex flex-col gap-1 text-body">
          {language.t("agents.hosts.search")}
          <input
            class={input({ size: "sm", class: "w-full" })}
            value={state.search}
            onInput={(event) => setState("search", event.currentTarget.value)}
          />
        </label>
        <Show when={workers.isError || workers.data?.available === false}>
          <p role="alert">{language.t("agents.hosts.workersUnavailable")}</p>
          <Button variant="outline" onClick={() => void workers.refetch()}>
            {language.t("common.retry")}
          </Button>
        </Show>
        <ul aria-label={language.t("agents.hosts.fleet")} class="m-0 mt-[var(--reddb-spatial-gap-md)] list-none p-0">
          <Key each={filtered()} by="id">
            {(host) => (
              <li>
                <HostRow
                  name={host().name}
                  description={host().description}
                  connection={host().connection}
                  selected={state.selected === host().id}
                  select={(button) => {
                    opener = button
                    setState({ selected: host().id, open: true })
                  }}
                />
              </li>
            )}
          </Key>
        </ul>
        <Show when={!filtered().length}>
          <p role="status" class="py-[var(--reddb-spatial-inset-md)] text-ink-muted">
            {language.t("agents.hosts.noMatches")}
          </p>
        </Show>
      </div>
      <Show when={inspected()}>
        <section
          ref={inspector}
          tabIndex={-1}
          aria-label={language.t("agents.hosts.inspector")}
          class={columns.main({
            class: `${columns.column()} ${panel.root({ class: "max-h-[calc(var(--agents-content-height,100dvh)-3rem)] overflow-hidden rounded-lg border border-muted focus-visible:outline-2 focus-visible:outline-focus" })}`,
          })}
        >
          <header class={panel.toolbar()}>
            <h3 class="min-w-0 text-body font-medium [overflow-wrap:anywhere]">{selected()?.name ?? state.selected}</h3>
            <Show when={navigation.mobile()}>
              <Button variant="ghost" onClick={back}>
                {language.t("agents.hosts.back")}
              </Button>
            </Show>
          </header>
          <div class={panel.body({ class: "overflow-y-auto overscroll-contain" })}>
            <Show when={selected()} fallback={<p role="alert">{language.t("agents.hosts.missingSelection")}</p>}>
              <Resources
                name={selected()?.name ?? state.selected}
                connected={connected() && (!state.selected || (!workers.isError && workers.data?.available !== false))}
                cacheKey={`${ServerConnection.key(props.server)}:${state.selected}`}
                load={(signal) =>
                  state.selected
                    ? ctx().sdk.api.workers.resources({ id: state.selected }, { signal })
                    : ctx().sdk.api.server.resources({ signal })
                }
              />
            </Show>
            <details class="text-body text-ink-muted">
              <summary class="cursor-pointer py-2">{language.t("agents.hosts.measurementDetails")}</summary>
              <p>{language.t("agents.hosts.runtimeNote")}</p>
            </details>
          </div>
        </section>
      </Show>
    </div>
  )
}

function HostRow(props: {
  name: string
  description: string
  connection: "online" | "offline" | "unchecked"
  selected: boolean
  select: (button: HTMLButtonElement) => void
}) {
  const language = useLanguage()
  const row = () => listRow({ size: "sm", interactive: true, selected: props.selected })
  const status = () =>
    statusIndicator({
      tone: props.connection === "online" ? "success" : props.connection === "offline" ? "danger" : "neutral",
    })
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      class={row().root({ class: "min-h-[var(--reddb-spatial-target-min)]" })}
      onClick={(event) => props.select(event.currentTarget)}
    >
      <span class={row().text()}>
        <span class={row().title()}>{props.name}</span>
        <span class={row().description()}>{props.description}</span>
        <span class={status().root()}>
          <span aria-hidden="true" class={status().mark()} />
          <span class={status().label()}>{language.t(`remoteWorkers.connection.${props.connection}`)}</span>
        </span>
      </span>
    </button>
  )
}

function Resources(props: {
  name: string
  connected: boolean
  cacheKey: string
  load: (signal: AbortSignal) => Promise<HostResourcesSnapshot>
}) {
  const language = useLanguage()
  const query = useQuery(() => ({
    queryKey: ["host-resources", props.cacheKey],
    queryFn: ({ signal }) => props.load(AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
    enabled: props.connected,
    retry: false,
    refetchInterval: 5000,
  }))
  const history = sharedSource(() => ({
    language: sharedLanguage(language),
    sample: query.data,
    // Reevaluate freshness on every completed poll, including identical cached payloads.
    available:
      props.connected && !query.isError && (!query.data || query.dataUpdatedAt - query.data.sampledAt <= 15_000),
    identity: props.cacheKey,
    connected: props.connected,
    loading: query.isPending,
  }))
  return (
    <article aria-label={props.name} class="py-[var(--reddb-spatial-inset-sm)]">
      <ReactView component={HostHistory} props={{ source: history, refresh: () => void query.refetch() }} />
    </article>
  )
}
