import type {
  ServerMemoryCapturesOutput,
  ServerStartMemoryCaptureInput,
  ServerStartMemoryCaptureOutput,
} from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useQuery } from "@tanstack/solid-query"
import { createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

type Capture = ServerStartMemoryCaptureOutput

export function MemoryCaptures(props: {
  connected: boolean
  identity: string
  list: (signal: AbortSignal) => Promise<ServerMemoryCapturesOutput>
  start: (input: ServerStartMemoryCaptureInput) => Promise<Capture>
  cancel: (id: string) => Promise<Capture>
  remove: (id: string) => Promise<void>
  download: (id: string) => Promise<Uint8Array>
}) {
  const language = useLanguage()
  const [busy, setBusy] = createSignal("")
  const [retention, setRetention] = createSignal(3_600_000)
  const query = useQuery(() => ({
    queryKey: ["memory-captures", props.identity],
    queryFn: ({ signal }) => props.list(AbortSignal.any([signal, AbortSignal.timeout(20_000)])),
    enabled: props.connected,
    retry: false,
    refetchInterval: (result) =>
      result.state.data?.some((capture) => capture.state === "pending" || capture.state === "running") ? 1_000 : 10_000,
  }))
  const run = (key: string, operation: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(key)
    void operation()
      .then(() => query.refetch())
      .catch((error) =>
        showToast({
          title: language.t("memory.captures.failed"),
          description: errorMessage(error, language.t("common.requestFailed")),
        }),
      )
      .finally(() => setBusy(""))
  }
  const start = (kind: "heap" | "cpu" | "samples") =>
    run(`start:${kind}`, () =>
      props.start({
        kind,
        target: { kind: "server" },
        retentionMs: retention(),
        ...(kind === "heap" ? {} : { durationMs: 10_000 }),
      }),
    )
  const download = (capture: Capture) =>
    run(`download:${capture.id}`, async () => {
      const bytes = await props.download(capture.id)
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "application/json" }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = capture.filename ?? `${capture.id}.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    })
  const bytes = (value: number) => {
    if (value < 1024) return `${value} B`
    const units = ["KiB", "MiB", "GiB"]
    const exponent = Math.min(units.length, Math.floor(Math.log(value) / Math.log(1024)))
    return `${(value / 1024 ** exponent).toFixed(1)} ${units[exponent - 1]}`
  }
  return (
    <section class="mt-4 border-t border-v2-border-border-base pt-3" aria-label={language.t("memory.captures.title")}>
      <div class="flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1">
          <h4 class="text-body font-medium">{language.t("memory.captures.title")}</h4>
          <p class="text-caption text-ink-muted">{language.t("memory.captures.description")}</p>
        </div>
        <label class="grid gap-1 text-caption text-ink-muted">
          {language.t("agents.memory.retention")}
          <select
            class="h-7 rounded border border-v2-border-border-base bg-transparent px-2 text-caption text-ink"
            value={retention()}
            onChange={(event) => setRetention(Number(event.currentTarget.value))}
          >
            <option value={3_600_000}>{language.t("agents.memory.oneHour")}</option>
            <option value={21_600_000}>{language.t("agents.memory.sixHours")}</option>
            <option value={86_400_000}>{language.t("agents.memory.twentyFourHours")}</option>
          </select>
        </label>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <Button size="small" variant="outline" disabled={!!busy()} onClick={() => start("samples")}>
          {language.t("memory.captures.samples")}
        </Button>
        <Button size="small" variant="outline" disabled={!!busy()} onClick={() => start("cpu")}>
          {language.t("memory.captures.cpu")}
        </Button>
        <Button size="small" variant="outline" disabled={!!busy()} onClick={() => start("heap")}>
          {language.t("memory.captures.heap")}
        </Button>
      </div>
      <Show when={query.isError}>
        <p class="mt-2 text-caption text-ink-muted" role="status">
          {language.t("memory.captures.unavailable")}
        </p>
      </Show>
      <ul class="m-0 mt-2 grid list-none gap-1 p-0">
        <For each={query.data ?? []}>
          {(capture) => (
            <li class="rounded border border-v2-border-border-base px-2 py-1 text-caption">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong>{language.t(`memory.captures.kind.${capture.kind}`)}</strong>
                <span class="text-ink-muted">{language.t(`memory.captures.state.${capture.state}`)}</span>
                <span class="text-ink-muted">{new Date(capture.createdAt).toLocaleString(language.intl())}</span>
                <Show when={capture.target.kind === "process" ? capture.target : undefined}>
                  {(target) => (
                    <span class="text-ink-muted">
                      {target().label ?? language.t("memory.captures.process")} · PID {target().pid}
                    </span>
                  )}
                </Show>
                <Show when={capture.size}>{(size) => <span class="text-ink-muted">{bytes(size())}</span>}</Show>
                <span class="ml-auto flex gap-1">
                  <Show when={capture.state === "pending" || capture.state === "running"}>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={!!busy()}
                      onClick={() => run(`cancel:${capture.id}`, () => props.cancel(capture.id))}
                    >
                      {language.t("common.cancel")}
                    </Button>
                  </Show>
                  <Show when={capture.state === "completed"}>
                    <Button size="small" variant="ghost" disabled={!!busy()} onClick={() => download(capture)}>
                      {language.t("memory.captures.download")}
                    </Button>
                  </Show>
                  <Show when={capture.state !== "pending" && capture.state !== "running"}>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={!!busy()}
                      onClick={() => run(`remove:${capture.id}`, () => props.remove(capture.id))}
                    >
                      {language.t("common.delete")}
                    </Button>
                  </Show>
                </span>
              </div>
              <Show when={capture.error}>
                <p class="mt-1 text-v2-text-text-danger" role="alert">
                  {capture.error}
                </p>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
