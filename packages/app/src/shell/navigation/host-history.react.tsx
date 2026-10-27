/** @jsxImportSource react */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { Cpu, MemoryStick, Activity, Layers } from "lucide-react"
import type { HostResourcesSnapshot } from "@opencode/client/promise"
import { Button } from "@reddb-io/design-system/base/Button"
import { Card } from "@reddb-io/design-system/base/Card"
import { Statistic } from "@reddb-io/design-system/base/Statistic"
import { Select } from "@reddb-io/design-system/base/Select"
import { Icon } from "@reddb-io/design-system/base/Icon"
import { RadialProgress } from "@reddb-io/design-system/base/RadialProgress"
import type { ColorToken } from "@reddb-io/design-system/base/recipes"
import { ErrorBoundary } from "@reddb-io/design-system/app/ErrorBoundary"
import { CompositeChart } from "@reddb-io/design-system/data/CompositeChart"
import { createChartStream } from "@reddb-io/design-system/data/stream"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"

type Observation = { x: number; cpu: number | null; memory: number | null; process: number | null }

export function HostHistory(props: {
  source: SharedSource<{
    language: SharedLanguage
    sample: HostResourcesSnapshot | undefined
    available: boolean
    identity: string
    connected: boolean
    loading: boolean
  }>
  refresh(): void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const stream = useMemo(
    () => createChartStream<Observation>({ maxPoints: 600, windowMs: 600_000, intervalMs: 0 }),
    [view.identity],
  )
  const snapshot = useSyncExternalStore(stream.subscribe, stream.getSnapshot, stream.getServerSnapshot)
  const [activeX, setActiveX] = useState<number | null>(null)
  const [windowMs, setWindowMs] = useState(600_000)
  useEffect(() => () => stream.dispose(), [stream])
  useEffect(() => {
    const sample = view.sample
    if (!sample) return
    const stale = !view.available
    stream.upsert({
      x: stale ? Date.now() : sample.sampledAt,
      cpu: stale || sample.cpu.utilization === null ? null : sample.cpu.utilization * 100,
      memory:
        stale || sample.memory.totalBytes === null || sample.memory.freeBytes === null
          ? null
          : (sample.memory.totalBytes - sample.memory.freeBytes) / 1024 ** 3,
      process: stale ? null : sample.process.residentBytes / 1024 ** 3,
    })
    stream.flush()
  }, [stream, view.sample, view.available])
  const last = snapshot.data.at(-1)?.x
  const timeRange = last === undefined ? undefined : ([last - windowMs, last] as const)
  const sample = view.available ? view.sample : undefined
  const bytes = (value: number | null) =>
    value === null
      ? language.t("agents.hosts.unknown")
      : language.t("agents.hosts.memoryValue", { value: (value / 1024 ** 3).toFixed(2) })
  return (
    <ErrorBoundary
      title={language.t("usage.chartError")}
      retryLabel={language.t("common.retry")}
      resetKey={view.identity}
    >
      <section aria-label={language.t("agents.hosts.history")} className="@container/resources mb-4 min-w-0">
        {!view.available && (
          <div role="alert">
            <p>{language.t("agents.hosts.unavailable")}</p>
            <Button variant="secondary" disabled={!view.connected} onClick={props.refresh}>
              {language.t("common.retry")}
            </Button>
          </div>
        )}
        {view.loading && view.available && <p role="status">{language.t("agents.loading")}</p>}
        {sample && (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="m-0 text-body font-medium">{language.t("agents.hosts.overview")}</h4>
              <span className="text-caption text-ink-muted">{sample.platform}</span>
            </div>
            <div className="mb-3 grid min-w-0 gap-3 @sm/resources:grid-cols-2">
              <Card padding="sm">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <Statistic
                    className="flex-1"
                    label={language.t("agents.hosts.cpu")}
                    value={
                      sample.cpu.utilization === null
                        ? language.t("agents.hosts.unknown")
                        : Math.round(sample.cpu.utilization * 100)
                    }
                    formatValue={(value) =>
                      sample.cpu.utilization === null ? String(value) : language.t("agents.hosts.percent", { value })
                    }
                    description={sample.cpu.utilization === null ? language.t("agents.hosts.sampling") : undefined}
                    animate
                  />
                  {sample.cpu.utilization !== null && (
                    <ResourceGauge
                      label={language.t("agents.hosts.cpu")}
                      value={sample.cpu.utilization * 100}
                      color="--reddb-color-series-1"
                    >
                      <Icon icon={Cpu} size="md" />
                    </ResourceGauge>
                  )}
                </div>
              </Card>
              <Card padding="sm">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <Statistic
                    className="flex-1"
                    label={language.t("agents.hosts.runtimeMemory")}
                    value={sample.memory.freeBytes ?? language.t("agents.hosts.unknown")}
                    formatValue={() => bytes(sample.memory.freeBytes)}
                    description={language.t("agents.hosts.memoryPair", {
                      free: bytes(sample.memory.freeBytes),
                      total: bytes(sample.memory.totalBytes),
                    })}
                    animate
                  />
                  {sample.memory.freeBytes !== null &&
                    sample.memory.totalBytes !== null &&
                    sample.memory.totalBytes > 0 && (
                      <ResourceGauge
                        label={language.t("agents.hosts.runtimeMemory")}
                        value={(sample.memory.freeBytes / sample.memory.totalBytes) * 100}
                        color="--reddb-color-series-2"
                      >
                        <Icon icon={MemoryStick} size="md" />
                      </ResourceGauge>
                    )}
                </div>
              </Card>
              <Card padding="sm">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <Statistic
                    className="flex-1"
                    label={language.t("agents.hosts.process")}
                    value={sample.process.residentBytes}
                    formatValue={() => bytes(sample.process.residentBytes)}
                    animate
                  />
                  <span aria-hidden="true" className="text-ink-muted">
                    <Icon icon={Activity} size="lg" />
                  </span>
                </div>
              </Card>
              <Card padding="sm">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <Statistic
                    className="flex-1"
                    label={language.t("agents.hosts.cores")}
                    value={sample.cpu.count ?? language.t("agents.hosts.unknown")}
                    animate
                  />
                  <span aria-hidden="true" className="text-ink-muted">
                    <Icon icon={Layers} size="lg" />
                  </span>
                </div>
              </Card>
            </div>
            <p className="text-caption text-ink-muted">
              {language.t("agents.hosts.sampled", {
                time: new Date(sample.sampledAt).toLocaleTimeString(language.intl),
              })}
            </p>
          </>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            aria-pressed={snapshot.paused}
            onClick={() => (snapshot.paused ? stream.resume() : stream.pause())}
          >
            {language.t(snapshot.paused ? "agents.hosts.live" : "agents.hosts.pause")}
          </Button>
          <label>
            {language.t("agents.hosts.window")}
            <Select value={String(windowMs)} onValueChange={(value) => setWindowMs(Number(value))}>
              <option value={60_000}>{language.t("agents.hosts.oneMinute")}</option>
              <option value={600_000}>{language.t("agents.hosts.tenMinutes")}</option>
            </Select>
          </label>
          <p className="text-caption text-ink-muted">{language.t("agents.hosts.localHistory")}</p>
        </div>
        <div className="grid min-w-0 gap-3 @3xl/resources:grid-cols-2">
          <CompositeChart
            label={language.t("agents.hosts.cpu")}
            layout="dense"
            size="sm"
            readout="overlay"
            legend="hidden"
            strokeWidth={1}
            activeX={activeX}
            onActiveXChange={setActiveX}
            timeRange={timeRange}
            expandLabel={language.t("agents.chart.expand")}
            restoreLabel={language.t("common.close")}
            formatX={(x) => new Date(x).toLocaleTimeString(language.intl)}
            primaryAxis={{
              label: language.t("agents.hosts.cpu"),
              domain: [0, 100],
              format: (value) => language.t("agents.hosts.percent", { value: value.toFixed(1) }),
            }}
            data={[
              {
                id: "cpu",
                kind: "line",
                series: 1,
                label: language.t("agents.hosts.cpu"),
                data: snapshot.data.map((point) => ({ x: point.x, y: point.cpu })),
              },
            ]}
          />
          <CompositeChart
            label={language.t("agents.hosts.historyMemory")}
            layout="dense"
            size="sm"
            readout="overlay"
            strokeWidth={1}
            activeX={activeX}
            onActiveXChange={setActiveX}
            timeRange={timeRange}
            expandLabel={language.t("agents.chart.expand")}
            restoreLabel={language.t("common.close")}
            formatX={(x) => new Date(x).toLocaleTimeString(language.intl)}
            primaryAxis={{
              label: language.t("agents.hosts.historyMemory"),
              format: (value) => language.t("agents.hosts.memoryValue", { value: value.toFixed(2) }),
            }}
            data={[
              {
                id: "memory",
                kind: "line",
                series: 2,
                label: language.t("agents.hosts.usedMemory"),
                data: snapshot.data.map((point) => ({ x: point.x, y: point.memory })),
              },
              {
                id: "process",
                kind: "line",
                series: 3,
                label: language.t("agents.hosts.process"),
                data: snapshot.data.map((point) => ({ x: point.x, y: point.process })),
              },
            ]}
          />
        </div>
      </section>
    </ErrorBoundary>
  )
}

/** Resource utilization is exposed as a meter; the radial supplies decorative geometry. */
function ResourceGauge(props: { label: string; value: number; color: ColorToken; children: ReactNode }) {
  return (
    <div role="meter" aria-label={props.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.value}>
      <RadialProgress
        aria-hidden="true"
        label={props.label}
        value={props.value}
        diameter={44}
        thickness={0.05}
        color={props.color}
        center={() => props.children}
      />
    </div>
  )
}
