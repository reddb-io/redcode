/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { MemoryStick } from "lucide-react"
import { ErrorBoundary } from "@reddb-io/design-system/app/ErrorBoundary"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@reddb-io/design-system/base/Icon"
import { RadialProgress } from "@reddb-io/design-system/base/RadialProgress"
import { CompositeChart } from "@reddb-io/design-system/data/CompositeChart"
import { KpiCard } from "@reddb-io/design-system/data/KpiCard"
import { Sparkline } from "@reddb-io/design-system/data/Sparkline"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"

type Snapshot = {
  language: SharedLanguage
  server: string
  connected: boolean
  serverBytes: number | undefined
  desktopBytes: number | undefined
  executions: number | undefined
  sessions: number
  sessionTotal: number | undefined
  agents: number
  subagents: number
  machines: number
  onlineMachines: number
  workers: number
  onlineWorkers: number
  serverLatency: number | undefined
  workerLatency: number | undefined
  clients:
    | {
        total: number
        desktop: number
        web: number
        tui: number
        cli: number
        api: number
        automation: number
        worker: number
        unknown: number
      }
    | undefined
  performance:
    | {
        sampledAt: number
        from: number
        requests: number
        errors: number
        latencyP50?: number
        latencyP95?: number
        throughputP50?: number
        providers: {
          providerID: string
          requests: number
          errors: number
          latencyP50?: number
          latencyP95?: number
          throughputP50?: number
        }[]
        models: {
          model: { providerID: string; id: string; variant?: string }
          requests: number
          errors: number
          latencyP50?: number
          latencyP95?: number
          throughputP50?: number
        }[]
      }
    | undefined
  totalBytes: number | undefined
  cpuPercent: number | undefined
  history: { x: number; cpu: number | null; memory: number | null; process: number | null }[]
  trend: number[]
  growth: number
  alert: "disconnected" | "unavailable" | "high" | "growing" | "executionUnavailable" | "partial" | undefined
  sampledAt: number | undefined
}

export function HomeRuntimeView(props: { source: SharedSource<Snapshot>; open: () => void }) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const bytes = (value: number | undefined) =>
    value === undefined
      ? language.t("agents.hosts.unknown")
      : language.t("agents.hosts.memoryValue", { value: (value / 1024 ** 3).toFixed(2) })
  const memory = (value: number) => language.t("agents.hosts.memoryValue", { value: value.toFixed(2) })
  const latency = (value: number | undefined) =>
    value === undefined
      ? language.t("agents.hosts.unknown")
      : value < 1_000
        ? language.t("home.performance.milliseconds", { value: Math.round(value) })
        : language.t("home.performance.seconds", { value: (value / 1_000).toFixed(value < 10_000 ? 1 : 0) })
  const rate = (value: number | undefined) =>
    value === undefined
      ? language.t("agents.hosts.unknown")
      : language.t("home.performance.tokensPerSecond", {
          value: new Intl.NumberFormat(language.intl, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value),
        })
  const alert = view.alert ? language.t(`home.runtime.alert.${view.alert}`, { value: view.growth.toFixed(2) }) : undefined
  const hasChart = view.history.length > 1
  const period = hasChart
    ? [view.history[0]!.x, view.history.at(-1)!.x].map((value) =>
        new Date(value).toLocaleTimeString(language.intl, { hour: "2-digit", minute: "2-digit" }),
      )
    : []
  const kpiClass =
    "rounded-lg px-3 py-2 [&_[data-kpi-value]]:whitespace-nowrap [&_[data-kpi-value]]:text-xl [&_[data-kpi-value]]:font-medium [&_[data-kpi-value]]:tracking-tight [&_[data-kpi-sparkline]]:w-14"

  return (
    <section aria-label={language.t("home.runtime.title")} className="pt-3 md:pt-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-eyebrow uppercase text-ink-muted">{language.t("home.runtime.title")}</h2>
            <span
              aria-label={language.t(view.connected ? "home.runtime.connected" : "home.runtime.disconnected")}
              className={`size-1.5 shrink-0 rounded-full ${view.connected ? "bg-feedback-success-foreground" : "bg-feedback-danger-foreground"}`}
            />
          </div>
          <p className="m-0 truncate text-caption text-ink-muted">{view.server}</p>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={props.open}>
          {language.t("home.runtime.details")}
        </Button>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 @3xl:grid-cols-4">
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.serverMemory")}
          value={bytes(view.serverBytes)}
          delta={view.trend.length >= 3 ? view.growth : null}
          deltaSuffix=" GiB"
          deltaLabel={language.t("home.runtime.recordedWindow")}
          polarity="lower-is-better"
          tone={view.alert === "high" || view.alert === "growing" ? "warning" : "neutral"}
          sparkline={
            view.totalBytes && view.serverBytes ? (
              <RadialProgress
                label={language.t("home.runtime.serverShare")}
                value={view.serverBytes}
                max={view.totalBytes}
                diameter={34}
                thickness={0.05}
                color="--reddb-color-series-2"
                center={() => <Icon icon={MemoryStick} size="sm" />}
              />
            ) : view.trend.length > 1 ? (
              <Sparkline values={view.trend} height={24} strokeWidth={1} series={2} loading="eager" />
            ) : undefined
          }
        />
        <KpiCard className={kpiClass} label={language.t("home.runtime.desktopMemory")} value={bytes(view.desktopBytes)} />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.sessions")}
          value={view.sessions}
          description={
            view.sessionTotal === undefined
              ? undefined
              : language.plural("home.runtime.sessionsDescription", view.sessionTotal, { count: view.sessionTotal })
          }
        />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.agents")}
          value={view.agents}
          description={language.plural("home.runtime.agentsDescription", view.subagents, { count: view.subagents })}
        />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.machines")}
          value={`${view.onlineMachines}/${view.machines}`}
          description={
            view.serverLatency === undefined
              ? language.t("home.runtime.connectedDescription")
              : language.t("home.runtime.selectedLatency", { value: latency(view.serverLatency) })
          }
        />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.workers")}
          value={`${view.onlineWorkers}/${view.workers}`}
          description={
            view.workerLatency === undefined
              ? language.t("home.runtime.onlineDescription")
              : language.t("home.runtime.workerLatency", { value: latency(view.workerLatency) })
          }
        />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.clients")}
          value={view.clients?.total ?? language.t("agents.hosts.unknown")}
          description={
            view.clients
              ? language.t("home.runtime.clientsDescription", {
                  desktop: view.clients.desktop,
                  web: view.clients.web,
                  tui: view.clients.tui,
                })
              : undefined
          }
        />
        <KpiCard
          className={kpiClass}
          label={language.t("home.runtime.executions")}
          value={view.executions ?? language.t("agents.hosts.unknown")}
          description={
            view.cpuPercent === undefined ? undefined : language.t("home.runtime.cpuNow", { value: view.cpuPercent.toFixed(1) })
          }
        />
      </div>

      {view.performance && view.performance.requests > 0 && (
        <div className="mt-2 rounded-lg border border-muted px-3 py-2">
          <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
            <h3 className="m-0 text-caption font-medium">{language.t("home.performance.title")}</h3>
            <span className="truncate text-caption text-ink-muted">
              {language.plural("home.performance.responses", view.performance.requests, {
                count: view.performance.requests,
                errors: view.performance.errors,
              })}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <KpiCard
              className={kpiClass}
              label={language.t("home.performance.latencyP50")}
              value={latency(view.performance.latencyP50)}
            />
            <KpiCard
              className={kpiClass}
              label={language.t("home.performance.latencyP95")}
              value={latency(view.performance.latencyP95)}
            />
            <KpiCard
              className={kpiClass}
              label={language.t("home.performance.throughputP50")}
              value={rate(view.performance.throughputP50)}
            />
          </div>
          <div className="mt-2 grid gap-x-5 gap-y-2 @3xl:grid-cols-2">
            <PerformanceList
              title={language.t("home.performance.providers")}
              items={view.performance.providers.slice(0, 3).map((item) => ({
                id: item.providerID,
                label: item.providerID,
                requests: item.requests,
                errors: item.errors,
                latency: latency(item.latencyP50),
                rate: rate(item.throughputP50),
              }))}
              language={language}
            />
            <PerformanceList
              title={language.t("home.performance.models")}
              items={view.performance.models.slice(0, 3).map((item) => ({
                id: `${item.model.providerID}/${item.model.id}${item.model.variant ? `#${item.model.variant}` : ""}`,
                label: item.model.variant ? `${item.model.id} · ${item.model.variant}` : item.model.id,
                requests: item.requests,
                errors: item.errors,
                latency: latency(item.latencyP50),
                rate: rate(item.throughputP50),
              }))}
              language={language}
            />
          </div>
        </div>
      )}

      {hasChart && (
        <ErrorBoundary
          title={language.t("usage.chartError")}
          retryLabel={language.t("common.retry")}
          resetKey={`${view.server}:${view.sampledAt ?? 0}`}
        >
          <div className="mt-2 rounded-lg border border-muted px-3 pb-2 pt-2">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-caption font-medium">{language.t("home.runtime.chart")}</h3>
              <span className="text-caption text-ink-muted">{language.t("home.runtime.chartDescription")}</span>
            </div>
            <CompositeChart
              label={language.t("home.runtime.chart")}
              data={[
                {
                  id: "host-memory",
                  label: language.t("agents.hosts.usedMemory"),
                  kind: "column",
                  series: 1,
                  data: view.history.map((point) => ({ x: point.x, y: point.memory })),
                },
                {
                  id: "server-memory",
                  label: language.t("agents.hosts.process"),
                  kind: "area",
                  series: 2,
                  gradient: true,
                  data: view.history.map((point) => ({ x: point.x, y: point.process })),
                },
                {
                  id: "cpu",
                  label: language.t("agents.hosts.cpu"),
                  kind: "line",
                  axis: "secondary",
                  series: 3,
                  data: view.history.map((point) => ({ x: point.x, y: point.cpu })),
                },
              ]}
              primaryAxis={{ label: language.t("agents.hosts.historyMemory"), format: memory }}
              secondaryAxis={{ label: language.t("agents.hosts.cpu"), format: (value) => `${value.toFixed(0)}%` }}
              formatX={(value) =>
                new Date(value instanceof Date ? value.getTime() : value).toLocaleTimeString(language.intl, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              layout="dense"
              height={88}
              presentation="minimal"
              readout="overlay"
              legend="hidden"
              interactive
              expandable={false}
              strokeWidth={1}
              barPadding={0.62}
              loading="eager"
              className="[&_[data-composite-column]]:opacity-35 [&_[fill-opacity]]:opacity-25"
            />
            <div className="mt-1 flex justify-between text-caption text-ink-muted">
              {period.map((value, index) => (
                <span key={index}>{value}</span>
              ))}
            </div>
          </div>
        </ErrorBoundary>
      )}

      {alert && <p role="alert" className="mb-0 mt-2 text-caption text-feedback-warning-foreground">{alert}</p>}
      {!alert && view.sampledAt && (
        <p className="mb-0 mt-2 text-caption text-ink-muted">
          {language.t("agents.hosts.sampled", { time: new Date(view.sampledAt).toLocaleTimeString(language.intl) })}
        </p>
      )}
    </section>
  )
}

function PerformanceList(props: {
  title: string
  items: { id: string; label: string; requests: number; errors: number; latency: string; rate: string }[]
  language: SharedLanguage
}) {
  return (
    <div className="min-w-0">
      <h4 className="m-0 mb-1 text-eyebrow uppercase text-ink-muted">{props.title}</h4>
      <div className="grid gap-0.5">
        {props.items.map((item) => (
          <div key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-0.5 text-caption">
            <span className="truncate" title={item.id}>{item.label}</span>
            <span className="tabular-nums text-ink-muted">{item.latency}</span>
            <span
              className={item.errors > 0 ? "tabular-nums text-feedback-warning-foreground" : "tabular-nums text-ink-muted"}
              title={props.language.plural("home.performance.requests", item.requests, {
                count: item.requests,
                errors: item.errors,
              })}
            >
              {item.rate}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
