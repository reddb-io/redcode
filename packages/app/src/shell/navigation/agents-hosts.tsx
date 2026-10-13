import type { HostResourcesSnapshot } from "@opencode/client/promise"
import { card } from "@reddb-io/design-system/contracts/card"
import { Button } from "@opencode/ui/button"
import { useQuery } from "@tanstack/solid-query"
import { Show } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"

export default function AgentHosts(props: { server: ServerConnection.Any }) {
  const global = useGlobal()
  const ctx = () => global.ensureServerCtx(props.server)
  const language = useLanguage()
  const connected = () => ctx().sdk.connection.status() === "connected"
  const workers = useQuery(() => ({
    queryKey: ["remote-workers", ServerConnection.key(props.server)],
    queryFn: ({ signal }) => ctx().sdk.api.workers.list({ signal }),
    enabled: connected(),
    retry: false,
    refetchInterval: 5000,
  }))
  return (
    <div class="flex flex-col gap-4">
      <Resources
        name={language.t("agents.hosts.coordinator")}
        connected={connected()}
        cacheKey={ServerConnection.key(props.server)}
        load={(signal) => ctx().sdk.api.server.resources({ signal })}
      />
      <Show when={workers.isError}>
        <p role="alert">{language.t("agents.hosts.workersUnavailable")}</p>
        <Button variant="outline" onClick={() => void workers.refetch()}>
          {language.t("common.retry")}
        </Button>
      </Show>
      <Key each={workers.data?.workers} by={(item) => item.worker.id}>
        {(item) => (
          <Resources
            name={item().worker.id}
            connected={connected() && !workers.isError}
            cacheKey={`${ServerConnection.key(props.server)}:${item().worker.id}`}
            load={(signal) => ctx().sdk.api.workers.resources({ id: item().worker.id }, { signal })}
          />
        )}
      </Key>
      <p class="text-13-regular leading-[var(--line-height-base)] text-ink-muted">
        {language.t("agents.hosts.runtimeNote")}
      </p>
    </div>
  )
}

function Resources(props: {
  name: string
  connected: boolean
  cacheKey: string
  load: (signal: AbortSignal) => Promise<HostResourcesSnapshot>
}) {
  const language = useLanguage()
  const appearance = card({ padding: "md" })
  const query = useQuery(() => ({
    queryKey: ["host-resources", props.cacheKey],
    queryFn: ({ signal }) => props.load(AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
    enabled: props.connected,
    retry: false,
    refetchInterval: 5000,
  }))
  const bytes = (value: number | null) =>
    value === null
      ? language.t("agents.hosts.unknown")
      : language.t("agents.hosts.memoryValue", { value: (value / 1024 ** 3).toFixed(2) })
  return (
    <article aria-label={props.name} class={appearance.root()}>
      <div class={appearance.body({ class: "flex flex-col gap-3" })}>
        <h3 class="text-13-medium leading-[var(--line-height-base)]">{props.name}</h3>
        <Show
          when={props.connected && !query.isError}
          fallback={
            <div role="alert">
              <p>{language.t("agents.hosts.unavailable")}</p>
              <Button variant="outline" disabled={!props.connected} onClick={() => void query.refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          }
        >
          <Show when={query.data} fallback={<p role="status">{language.t("agents.loading")}</p>} keyed>
            {(sample) => (
              <>
                <p class="text-13-regular text-ink-muted">{sample.platform}</p>
                <dl class="grid gap-3 text-13-regular leading-[var(--line-height-base)] sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt class="text-ink-muted">{language.t("agents.hosts.cpu")}</dt>
                    <dd>
                      {sample.cpu.utilization === null
                        ? language.t("agents.hosts.sampling")
                        : language.t("agents.hosts.percent", { value: Math.round(sample.cpu.utilization * 100) })}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-ink-muted">{language.t("agents.hosts.cores")}</dt>
                    <dd>{sample.cpu.count ?? language.t("agents.hosts.unknown")}</dd>
                  </div>
                  <div>
                    <dt class="text-ink-muted">{language.t("agents.hosts.runtimeMemory")}</dt>
                    <dd>
                      {language.t("agents.hosts.memoryPair", {
                        free: bytes(sample.memory.freeBytes),
                        total: bytes(sample.memory.totalBytes),
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-ink-muted">{language.t("agents.hosts.process")}</dt>
                    <dd>{bytes(sample.process.residentBytes)}</dd>
                  </div>
                </dl>
                <p class="text-caption text-ink-muted">
                  {language.t("agents.hosts.sampled", { time: new Date(sample.sampledAt).toLocaleTimeString() })}
                </p>
              </>
            )}
          </Show>
        </Show>
      </div>
    </article>
  )
}
