import { useQuery } from "@tanstack/solid-query"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { executionHistory, recordExecutions } from "./resource-history"

type MemorySample = { pid: number; createdAt: number; type: string; residentBytes: number | null }[]

/** Electron measures the local client, which may not be on the selected server's machine. */
export function DesktopMemory() {
  const language = useLanguage()
  const native = (window as Window & { electron?: { getMemorySample?: () => Promise<MemorySample> } }).electron
  const [history, setHistory] = createSignal<Record<string, [number, number][]>>({})
  let last = ""
  const storage = () => {
    try {
      return window.localStorage
    } catch {
      return { getItem: () => null, setItem: () => {} }
    }
  }
  const refresh = () => {
    setHistory(executionHistory(storage(), "desktop-local"))
    last = ""
  }
  window.addEventListener("redcode:memory-retention", refresh)
  onCleanup(() => window.removeEventListener("redcode:memory-retention", refresh))
  const sample = useQuery(() => ({
    queryKey: ["desktop-memory"],
    queryFn: () => native!.getMemorySample!(),
    enabled: !!native?.getMemorySample,
    retry: false,
    refetchInterval: 10_000,
  }))
  createEffect(() => {
    const entries = sample.data
    if (!entries || sample.isError) return
    const now = Date.now()
    const bucket = `${Math.floor(now / 300_000)}:${entries.map((item) => `${item.pid}:${item.createdAt}`).join(",")}`
    if (last === bucket) return
    recordExecutions(
      storage(),
      "desktop-local",
      entries.map((item) => ({
        kind: "desktop",
        id: `${item.pid}:${item.createdAt}`,
        residentBytes: item.residentBytes,
      })),
      now,
    )
    setHistory(executionHistory(storage(), "desktop-local", now))
    last = bucket
  })
  return (
    <section
      aria-label={language.t("agents.memory.desktop")}
      class="mb-4 rounded-lg border border-v2-border-border-base p-3"
    >
      <h2 class="text-13-medium">{language.t("agents.memory.desktop")}</h2>
      <p class="text-caption text-ink-muted">{language.t("agents.memory.desktopNote")}</p>
      <Show
        when={native?.getMemorySample}
        fallback={<p class="text-caption text-ink-muted">{language.t("agents.memory.desktopUnavailable")}</p>}
      >
        <Show when={!sample.isError} fallback={<p role="alert">{language.t("agents.memory.unavailable")}</p>}>
          <ul class="m-0 grid gap-1 p-0">
            <For each={sample.data}>
              {(process) => (
                <li class="text-caption">
                  <div class="flex justify-between gap-3">
                    <span>
                      {process.type} · PID {process.pid}
                    </span>
                    <span>
                      {process.residentBytes === null
                        ? language.t("agents.hosts.unknown")
                        : language.t("agents.hosts.memoryValue", {
                            value: (process.residentBytes / 1024 ** 3).toFixed(2),
                          })}
                    </span>
                  </div>
                  <Show when={history()[`desktop:${process.pid}:${process.createdAt}`]?.length}>
                    <details class="text-ink-muted">
                      <summary>{language.t("agents.memory.executionHistory")}</summary>
                      <ol class="max-h-40 overflow-auto pl-4">
                        <For each={history()[`desktop:${process.pid}:${process.createdAt}`]}>
                          {(point) => (
                            <li>
                              {new Date(point[0]).toLocaleString(language.intl())} ·{" "}
                              {language.t("agents.hosts.memoryValue", { value: (point[1] / 1024 ** 3).toFixed(2) })}
                            </li>
                          )}
                        </For>
                      </ol>
                    </details>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}
