/** @jsxImportSource react */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { HostResourcesSnapshot } from "@opencode/client/promise"
import { Button } from "@reddb-io/design-system/base/Button"
import { Card } from "@reddb-io/design-system/base/Card"
import { Statistic } from "@reddb-io/design-system/base/Statistic"
import { Select } from "@reddb-io/design-system/base/Select"
import { meter } from "@reddb-io/design-system/base/recipes"
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
    const stale = !view.available || Date.now() - sample.sampledAt > 15_000
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
  const track = meter()
  return (
    <ErrorBoundary
      title={language.t("usage.chartError")}
      retryLabel={language.t("common.retry")}
      resetKey={view.identity}
    >
      <section aria-label={language.t("agents.hosts.history")} className="mb-4 min-w-0">
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
            <p className="text-caption text-ink-muted">{sample.platform}</p>
            <div className="mb-3 grid min-w-0 grid-cols-2 gap-[var(--reddb-spatial-gap-lg)]">
              <Card padding="md">
                <div className="flex min-w-0 flex-col gap-3">
                  <Statistic
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
                    <div
                      role="meter"
                      aria-label={language.t("agents.hosts.cpu")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={sample.cpu.utilization * 100}
                      className={track.track({ class: "h-[2px]" })}
                    >
                      <div className={track.indicator()} style={{ width: `${sample.cpu.utilization * 100}%` }} />
                    </div>
                  )}
                </div>
              </Card>
              <Card padding="md">
                <div className="flex min-w-0 flex-col gap-3">
                  <Statistic
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
                      <div
                        role="meter"
                        aria-label={language.t("agents.hosts.runtimeMemory")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={(sample.memory.freeBytes / sample.memory.totalBytes) * 100}
                        className={track.track({ class: "h-[2px]" })}
                      >
                        <div
                          className={track.indicator()}
                          style={{ width: `${(sample.memory.freeBytes / sample.memory.totalBytes) * 100}%` }}
                        />
                      </div>
                    )}
                </div>
              </Card>
              <Card padding="md">
                <Statistic
                  label={language.t("agents.hosts.process")}
                  value={sample.process.residentBytes}
                  formatValue={() => bytes(sample.process.residentBytes)}
                  animate
                />
              </Card>
              <Card padding="md">
                <Statistic
                  label={language.t("agents.hosts.cores")}
                  value={sample.cpu.count ?? language.t("agents.hosts.unknown")}
                  animate
                />
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
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <CompositeChart
            label={language.t("agents.hosts.cpu")}
            layout="auto"
            size="sm"
            strokeWidth={1.25}
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
                kind: "area",
                label: language.t("agents.hosts.cpu"),
                data: snapshot.data.map((point) => ({ x: point.x, y: point.cpu })),
              },
            ]}
          />
          <CompositeChart
            label={language.t("agents.hosts.historyMemory")}
            layout="auto"
            size="sm"
            strokeWidth={1.25}
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
                kind: "area",
                label: language.t("agents.hosts.usedMemory"),
                data: snapshot.data.map((point) => ({ x: point.x, y: point.memory })),
              },
              {
                id: "process",
                kind: "line",
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
