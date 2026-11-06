import type { MemorySnapshot } from "@opencode/client/promise"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { executionHistory, recordExecutions } from "./resource-history"

const fallback = { getItem: () => null, setItem: () => {} }
function storage() {
  try {
    return window.localStorage
  } catch {
    return fallback
  }
}

export function ExecutionMemory(props: {
  identity: string
  connected: boolean
  load: (signal: AbortSignal) => Promise<MemorySnapshot>
}) {
  const language = useLanguage()
  const [history, setHistory] = createSignal<Record<string, [number, number][]>>({})
  let last = ""
  const refreshHistory = () => {
    setHistory(executionHistory(storage(), props.identity))
    last = ""
  }
  createEffect(() => {
    props.identity
    refreshHistory()
  })
  window.addEventListener("redcode:memory-retention", refreshHistory)
  onCleanup(() => window.removeEventListener("redcode:memory-retention", refreshHistory))
  const query = useQuery(() => ({
    queryKey: ["execution-memory", props.identity],
    queryFn: ({ signal }) => props.load(AbortSignal.any([signal, AbortSignal.timeout(20_000)])),
    enabled: props.connected,
    retry: false,
    refetchInterval: 30_000,
  }))
  createEffect(() => {
    const identity = props.identity
    const data = query.data
    if (!data || query.isError) return
    const now = Date.now()
    const bucket = `${identity}:${Math.floor(now / 300_000)}:${data.entries
      .filter((entry) => entry.residentBytes !== null)
      .map((entry) => `${entry.kind}:${entry.id}`)
      .join(",")}`
    if (bucket === last) return
    recordExecutions(storage(), identity, data.entries, now)
    setHistory(executionHistory(storage(), identity, now))
    last = bucket
  })
  const bytes = (value: number) => language.t("agents.hosts.memoryValue", { value: (value / 1024 ** 3).toFixed(2) })
  const previous = createMemo(() => {
    const active = new Set((query.data?.entries ?? []).map((entry) => `${entry.kind}:${entry.id}`))
    return Object.entries(history()).filter(([key, points]) => !active.has(key) && points.length)
  })
  return (
    <section class="mt-4" aria-label={language.t("agents.memory.executions")}>
      <h4 class="text-body font-medium">{language.t("agents.memory.executions")}</h4>
      <p class="text-caption text-ink-muted">{language.t("agents.memory.processNote")}</p>
      <Show
        when={props.connected && !query.isError}
        fallback={<p role="status">{language.t("agents.memory.processUnavailable")}</p>}
      >
        <Show when={query.data} fallback={<p role="status">{language.t("agents.loading")}</p>}>
          {(sample) => (
            <>
              <Show when={!sample().complete}>
                <p role="status">{language.t("agents.memory.partial")}</p>
              </Show>
              <Show
                when={sample().entries.length}
                fallback={<p class="text-caption text-ink-muted">{language.t("agents.memory.noExecutions")}</p>}
              >
                <ul class="m-0 mt-2 grid gap-1 p-0">
                  <For each={sample().entries}>
                    {(item) => {
                      const points = () => history()[`${item.kind}:${item.id}`] ?? []
                      return (
                        <li class="rounded border border-v2-border-border-base px-2 py-1 text-caption">
                          <div class="flex justify-between gap-3">
                            <span class="min-w-0 break-all">
                              {language.t(`agents.memory.kind.${item.kind}`)} · {item.title}
                              {item.pid ? ` · PID ${item.pid}` : ""}
                            </span>
                            <span class="shrink-0">
                              {item.residentBytes === null
                                ? language.t(
                                    item.reason === "shared" ? "agents.memory.shared" : "agents.memory.unavailable",
                                  )
                                : bytes(item.residentBytes)}
                            </span>
                          </div>
                          <Show when={points().length}>
                            <details class="text-ink-muted">
                              <summary class="cursor-pointer">{language.t("agents.memory.executionHistory")}</summary>
                              <ol class="max-h-40 overflow-auto pl-4">
                                <For each={points()}>
                                  {(point) => (
                                    <li>
                                      {new Date(point[0]).toLocaleString(language.intl())} · {bytes(point[1])}
                                    </li>
                                  )}
                                </For>
                              </ol>
                            </details>
                          </Show>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </Show>
      <Show when={previous().length}>
        <details class="mt-3 text-caption text-ink-muted">
          <summary class="cursor-pointer">{language.t("agents.memory.previousExecutions")}</summary>
          <For each={previous()}>
            {([key, points]) => (
              <details class="ml-2">
                <summary class="cursor-pointer break-all">{key}</summary>
                <ol class="max-h-40 overflow-auto pl-4">
                  <For each={points}>
                    {(point) => (
                      <li>
                        {new Date(point[0]).toLocaleString(language.intl())} · {bytes(point[1])}
                      </li>
                    )}
                  </For>
                </ol>
              </details>
            )}
          </For>
        </details>
      </Show>
    </section>
  )
}
