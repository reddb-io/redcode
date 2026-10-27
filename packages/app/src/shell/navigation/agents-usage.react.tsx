/** @jsxImportSource react */
import { useState, useSyncExternalStore } from "react"
import type { ComponentProps } from "react"
import { Maximize2, Receipt, RefreshCw } from "lucide-react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@reddb-io/design-system/base/Icon"
import { tokenColor } from "@reddb-io/design-system/base/recipes"
import { RadialProgress } from "@reddb-io/design-system/base/RadialProgress"
import { KpiCard } from "@reddb-io/design-system/data/KpiCard"
import { BreakdownBar, breakdownItems } from "@reddb-io/design-system/data/BreakdownBar"
import { automaticChartPalette } from "@reddb-io/design-system/data/recipes"
import { Sparkline } from "@reddb-io/design-system/data/Sparkline"
import { Select } from "@reddb-io/design-system/base/Select"
import { ToggleGroup } from "@reddb-io/design-system/base/ToggleGroup"
import { CompositeChart } from "@reddb-io/design-system/data/CompositeChart"
import { ErrorBoundary } from "@reddb-io/design-system/app/ErrorBoundary"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SessionStatsInfo, Project } from "@opencode/client/promise"

type Services = {
  snapshot: SharedSource<{
    language: SharedLanguage
    connected: boolean
    days: number
    project: string
    projects: readonly Project[]
    projectsError: boolean
    data: SessionStatsInfo | undefined
    loading: boolean
    error: boolean
  }>
  selectDays: (days: number) => void
  selectProject: (project: string) => void
  refresh: () => void
}

export function AgentUsageView(props: { services: Services }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const language = view.language
  const [activeX, setActiveX] = useState<number | null>(null)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const points = view.data?.series ?? []
  const tokens = (value: NonNullable<typeof view.data>["tokens"]) =>
    value.input + value.output + value.reasoning + value.cache.read + value.cache.write
  const money = (value: number) =>
    new Intl.NumberFormat(language.intl, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
  const date = (value: string | number | Date) => new Date(value).toLocaleDateString(language.intl, { timeZone: "UTC" })
  const models = view.data?.models ?? []
  const coverage = view.data?.costCoverage
  const accounted = coverage ? coverage.reported + coverage.estimated + coverage.unknown + coverage.legacy : 0
  const priced = coverage ? coverage.reported + coverage.estimated : 0
  const percent = (value: number) =>
    new Intl.NumberFormat(language.intl, { style: "percent", maximumFractionDigits: 1 }).format(value)
  const range =
    points.length > 1 ? ([Date.parse(points[0]!.date), Date.parse(points.at(-1)!.date)] as const) : undefined
  const period = points.length
    ? [points[0]!.date, points.at(-1)!.date].map((value) =>
        new Date(value).toLocaleDateString(language.intl, { month: "short", day: "numeric", timeZone: "UTC" }),
      )
    : []
  const tokenItems = breakdownItems([
    { id: "input", label: language.t("usage.inputTokens"), value: view.data?.tokens.input ?? 0, series: 1 },
    { id: "output", label: language.t("usage.outputTokens"), value: view.data?.tokens.output ?? 0, series: 3 },
    { id: "reasoning", label: language.t("usage.reasoningTokens"), value: view.data?.tokens.reasoning ?? 0, series: 4 },
    { id: "cache-read", label: language.t("usage.cacheRead"), value: view.data?.tokens.cache.read ?? 0, series: 5 },
    { id: "cache-write", label: language.t("usage.cacheWrite"), value: view.data?.tokens.cache.write ?? 0, series: 6 },
  ])
  return (
    <div className="@container/usage-dashboard flex min-w-0 flex-col gap-4 text-body">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="m-0 text-title font-medium">{language.t("usage.title")}</h2>
          <p className="mb-0 mt-1 text-caption text-ink-muted">{language.t("usage.overviewNote")}</p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @lg/usage-dashboard:w-auto">
          <ToggleGroup
            legend={language.t("usage.period")}
            className="[&>legend]:sr-only"
            value={String(view.days)}
            onValueChange={(value) => props.services.selectDays(value === "30" ? 30 : 7)}
            options={[
              { value: "7", label: language.t("usage.sevenDays") },
              { value: "30", label: language.t("usage.thirtyDays") },
            ]}
          />
          <Select
            controlSize="sm"
            className="w-full min-w-0 @lg/usage-dashboard:w-44"
            aria-label={language.t("usage.project")}
            value={view.project}
            disabled={view.projectsError}
            onValueChange={props.services.selectProject}
            options={[
              { value: "", label: language.t("usage.allProjects") },
              ...view.projects.map((project) => ({
                value: project.id,
                label: project.name || project.canonical || project.id,
              })),
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={language.t("agentTasks.refresh")}
            disabled={!view.connected}
            onClick={props.services.refresh}
          >
            <Icon icon={RefreshCw} size="sm" />
          </Button>
        </div>
      </div>
      {view.projectsError && <p role="status">{language.t("usage.projectsUnavailable")}</p>}
      {(!view.connected || view.error) && <p role="alert">{language.t("usage.unavailable")}</p>}
      {view.loading && <p role="status">{language.t("common.loading")}</p>}
      {view.data && (
        <>
          <div className="overflow-hidden rounded-xl border border-muted bg-elevation-raised-surface">
            <div
              role="group"
              aria-label={language.t("usage.totals", {
                cost: money(view.data.cost),
                tokens: tokens(view.data.tokens).toLocaleString(language.intl),
              })}
              className="grid min-w-0 divide-y divide-muted border-b border-muted @lg/usage-dashboard:grid-cols-3 @lg/usage-dashboard:divide-x @lg/usage-dashboard:divide-y-0"
            >
              {[
                {
                  id: "cost",
                  label: language.t("usage.cost"),
                  value: view.data.cost,
                  format: (value: number | string) => money(Number(value)),
                  values: points.map((point) => point.cost),
                  series: 1 as const,
                },
                {
                  id: "tokens",
                  label: language.t("usage.tokens"),
                  value: tokens(view.data.tokens),
                  format: (value: number | string) =>
                    new Intl.NumberFormat(language.intl, { notation: "compact", maximumFractionDigits: 1 }).format(
                      Number(value),
                    ),
                  values: points.map((point) => tokens(point.tokens)),
                  series: 1 as const,
                },
                {
                  id: "steps",
                  label: language.t("usage.steps"),
                  value: view.data.steps,
                  format: (value: number | string) =>
                    new Intl.NumberFormat(language.intl, { notation: "compact", maximumFractionDigits: 1 }).format(
                      Number(value),
                    ),
                  values: points.map((point) => point.steps),
                  series: 3 as const,
                },
              ].map((metric) => (
                <KpiCard
                  key={metric.id}
                  className="grid-cols-[minmax(0,1fr)_4rem] rounded-none border-0 bg-transparent px-5 py-4 @lg/usage-dashboard:grid-cols-1 @3xl/usage-dashboard:grid-cols-[minmax(0,1fr)_4rem] [&_[data-kpi-value]]:whitespace-nowrap [&_[data-kpi-value]]:text-3xl [&_[data-kpi-value]]:font-medium [&_[data-kpi-value]]:tracking-tight [&_[data-kpi-sparkline]]:w-full @lg/usage-dashboard:[&_[data-kpi-sparkline]]:hidden @3xl/usage-dashboard:[&_[data-kpi-sparkline]]:block"
                  label={metric.label}
                  value={metric.format(metric.value)}
                  sparkline={
                    metric.values.length > 1 ? (
                      <Sparkline
                        label={metric.label}
                        values={metric.values}
                        series={metric.series}
                        height={28}
                        strokeWidth={1}
                        variant="line"
                        curve="linear"
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
            <ErrorBoundary
              title={language.t("usage.chartError")}
              retryLabel={language.t("common.retry")}
              resetKey={`${view.project}:${view.days}`}
            >
              <div className="grid min-w-0 divide-y divide-muted @3xl/usage-dashboard:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] @3xl/usage-dashboard:divide-x @3xl/usage-dashboard:divide-y-0">
                <div className="min-w-0">
                  <UsagePlot
                    language={language}
                    note={language.t("usage.activityNote")}
                    period={period}
                    chart={{
                      label: language.t("usage.activityChart"),
                      activeX,
                      onActiveXChange: setActiveX,
                      timeRange: range,
                      formatX: date,
                      palette: { steps: "--reddb-color-series-3", tokens: "--reddb-color-series-1" },
                      primaryAxis: { label: language.t("usage.steps") },
                      secondaryAxis: { label: language.t("usage.tokens") },
                      data: [
                        {
                          id: "steps",
                          kind: "column",
                          label: language.t("usage.steps"),
                          data: points.map((point) => ({ x: Date.parse(point.date), y: point.steps })),
                        },
                        {
                          id: "tokens",
                          kind: "area",
                          axis: "secondary",
                          label: language.t("usage.tokens"),
                          data: points.map((point) => ({ x: Date.parse(point.date), y: tokens(point.tokens) })),
                        },
                      ],
                    }}
                  />
                  <section className="border-t border-muted px-5 py-4" aria-label={language.t("usage.tokenMix")}>
                    <h3 className="mb-2 mt-0 text-body font-medium">{language.t("usage.tokenMix")}</h3>
                    <BreakdownBar
                      className="[&_[role=group]]:hidden [&_[data-breakdown-segments]]:h-1.5 [&_[data-breakdown-segments]]:rounded-full"
                      label={language.t("usage.tokenMix")}
                      format={(value) => value.toLocaleString(language.intl)}
                      selected={selectedToken}
                      onSelectedChange={setSelectedToken}
                      items={tokenItems}
                    />
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 @xl/usage-dashboard:grid-cols-3">
                      {tokenItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={selectedToken === item.id}
                          onClick={() => setSelectedToken(selectedToken === item.id ? null : item.id)}
                          className="flex min-w-0 items-center gap-2 rounded text-caption outline-offset-4 aria-pressed:font-medium"
                        >
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: item.paint }}
                          />
                          <span className="text-ink-muted">{item.label}</span>
                          <span className="ml-auto tabular-nums">{item.value.toLocaleString(language.intl)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
                <div className="min-w-0">
                  <UsagePlot
                    language={language}
                    note={language.t("usage.costNote")}
                    height={96}
                    period={period}
                    chart={{
                      label: language.t("usage.costChart"),
                      columnMode: "stacked",
                      activeX,
                      onActiveXChange: setActiveX,
                      timeRange: range,
                      formatX: date,
                      primaryAxis: { label: language.t("usage.cost"), format: money },
                      data: [
                        ...models.map((model) => ({
                          id: `${model.model.providerID}/${model.model.id}#${model.model.variant ?? ""}`,
                          label: `${model.model.providerID}/${model.model.id}${model.model.variant ? ` (${model.model.variant})` : ""}`,
                          kind: "column" as const,
                          data: points.map((point) => ({
                            x: Date.parse(point.date),
                            y: point.models
                              .filter(
                                (item) =>
                                  item.model.providerID === model.model.providerID &&
                                  item.model.id === model.model.id &&
                                  item.model.variant === model.model.variant,
                              )
                              .reduce((sum, item) => sum + item.cost, 0),
                          })),
                        })),
                        {
                          id: "unattributed",
                          label: language.t("usage.unattributed"),
                          kind: "column",
                          color: "--reddb-color-ink-muted",
                          data: points.map((point) => ({
                            x: Date.parse(point.date),
                            y: Math.max(0, point.cost - point.models.reduce((sum, item) => sum + item.cost, 0)),
                          })),
                        },
                        {
                          id: "total-cost",
                          label: language.t("usage.totalCost"),
                          kind: "line",
                          color: "--reddb-color-foreground",
                          data: points.map((point) => ({ x: Date.parse(point.date), y: point.cost })),
                        },
                      ],
                    }}
                  />
                  <section className="border-t border-muted px-5 py-4" aria-label={language.t("usage.costCoverage")}>
                    <div className="flex min-w-0 items-center gap-3">
                      {coverage && accounted > 0 && (
                        <RadialProgress
                          label={language.t("usage.pricedRecords")}
                          value={priced}
                          max={accounted}
                          diameter={40}
                          thickness={0.05}
                          color="--reddb-color-series-1"
                          formatValue={(value) => percent(value / accounted)}
                          center={() => <Icon icon={Receipt} size="sm" />}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="m-0 text-body font-medium">{language.t("usage.costCoverage")}</h3>
                          {coverage && accounted > 0 && (
                            <span className="text-body font-medium tabular-nums">{percent(priced / accounted)}</span>
                          )}
                        </div>
                        <p className="mb-0 mt-1 text-caption text-ink-muted">
                          {coverage && accounted > 0
                            ? language.t("usage.coverageRatio", { known: priced, total: accounted })
                            : language.t("usage.coverageUnavailable")}
                        </p>
                      </div>
                    </div>
                    {coverage && (
                      <p className="mb-0 mt-3 text-caption text-ink-muted">
                        {language.t("usage.provenance", {
                          reported: coverage.reported,
                          estimated: coverage.estimated,
                          unknown: coverage.unknown,
                          legacy: coverage.legacy,
                        })}
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </ErrorBoundary>
          </div>

          {!points.length && <p role="status">{language.t("usage.empty")}</p>}
          <section className="min-w-0">
            <h3 className="mb-3 mt-0 text-body font-medium">{language.t("usage.daily")}</h3>
            <div className="max-h-60 overflow-auto rounded-lg border border-muted">
              <table className="w-full border-collapse text-caption tabular-nums">
                <caption className="sr-only">{language.t("usage.daily")}</caption>
                <thead className="sticky top-0 bg-elevation-raised-surface">
                  <tr>
                    {(["usage.date", "usage.steps", "usage.tokens", "usage.cost", "usage.unknown"] as const).map(
                      (key) => (
                        <th
                          key={key}
                          scope="col"
                          className="px-4 py-2 text-end font-normal text-ink-muted first:text-start"
                        >
                          {language.t(key)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {points.toReversed().map((point) => (
                    <tr key={point.date} className="border-t border-muted">
                      <th scope="row" className="whitespace-nowrap px-4 py-2 text-start font-normal">
                        {date(point.date)}
                      </th>
                      <td className="px-4 py-2 text-end">{point.steps.toLocaleString(language.intl)}</td>
                      <td className="px-4 py-2 text-end">{tokens(point.tokens).toLocaleString(language.intl)}</td>
                      <td className="px-4 py-2 text-end">{money(point.cost)}</td>
                      <td className="px-4 py-2 text-end">
                        {(point.costCoverage.unknown + point.costCoverage.legacy).toLocaleString(language.intl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <details className="text-caption text-ink-muted">
            <summary className="cursor-pointer">{language.t("usage.about")}</summary>
            <p className="mb-0 mt-2 max-w-prose">{language.t("usage.coverage")}</p>
          </details>
        </>
      )}
    </div>
  )
}

function UsagePlot(props: {
  language: SharedLanguage
  note: string
  period: readonly string[]
  height?: number
  chart: ComponentProps<typeof CompositeChart>
}) {
  const [expanded, setExpanded] = useState(false)
  const [hidden, setHidden] = useState<readonly string[]>([])
  const palette = props.chart.palette ?? automaticChartPalette(props.chart.data)
  const activeX = props.chart.activeX
  const coordinates = props.chart.data[0]?.data.map((point) => +point.x) ?? []
  const sample = coordinates.length
    ? coordinates.reduce(
        (nearest, value) =>
          activeX != null && Math.abs(value - +activeX) < Math.abs(nearest - +activeX) ? value : nearest,
        coordinates.at(-1)!,
      )
    : undefined
  return (
    <section aria-label={props.chart.label} className="min-w-0 p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-body font-medium">{props.chart.label}</h3>
          <p className="mb-0 mt-1 text-caption text-ink-muted">{props.note}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={props.language.t("usage.expandChart", { name: props.chart.label })}
          onClick={() => setExpanded(true)}
        >
          <Icon icon={Maximize2} size="sm" />
        </Button>
      </header>
      <CompositeChart
        {...props.chart}
        palette={palette}
        layout="dense"
        height={props.height ?? 128}
        presentation={expanded ? "full" : "minimal"}
        readout={expanded ? "inline" : "overlay"}
        legend={expanded ? "compact" : "hidden"}
        strokeWidth={1}
        barPadding={0.56}
        hiddenSeries={hidden}
        onHiddenSeriesChange={setHidden}
        expandable={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
        restoreLabel={props.language.t("common.close")}
        className="[&_[data-chart-axis-key]]:sr-only [&_[data-composite-column]]:opacity-50 [&_[fill-opacity]]:opacity-40 [&_[data-chart-explorer]]:border-b [&_[data-chart-explorer]]:border-muted"
      />
      {props.period.length > 0 && (
        <div className="mt-2 flex justify-between text-caption text-ink-muted">
          {props.period.map((date, index) => (
            <span key={index}>{date}</span>
          ))}
        </div>
      )}
      {sample !== undefined && (
        <p className="mb-2 mt-4 text-caption text-ink-muted">
          {props.language.t("usage.readingOn", {
            date: props.chart.formatX?.(sample) ?? String(sample),
          })}
        </p>
      )}
      <div
        className={
          props.chart.columnMode === "stacked"
            ? "grid gap-x-4 gap-y-2 @xl/usage-dashboard:grid-cols-2"
            : "grid grid-cols-2 gap-x-6 gap-y-2"
        }
      >
        {props.chart.data.map((series) => {
          if (series.kind === "candlestick") return null
          const point = series.data.find((point) => +point.x === sample)
          const format = (series.axis === "secondary" ? props.chart.secondaryAxis : props.chart.primaryAxis)?.format
          return (
            <button
              key={series.id}
              type="button"
              aria-label={series.label}
              aria-pressed={!hidden.includes(series.id)}
              title={series.label}
              onClick={() =>
                setHidden(hidden.includes(series.id) ? hidden.filter((id) => id !== series.id) : [...hidden, series.id])
              }
              className={`flex min-w-0 items-center gap-2 rounded text-caption outline-offset-4 aria-[pressed=false]:opacity-40 ${series.id === "total-cost" ? "col-span-full border-t border-muted pt-2 font-medium" : ""}`}
            >
              <span
                aria-hidden="true"
                style={{ background: tokenColor(series.color ?? palette[series.id], "currentColor") }}
                className={series.kind === "line" ? "h-px w-3 shrink-0" : "size-1.5 shrink-0 rounded-sm"}
              />
              <span className="truncate text-ink-muted">{series.label}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {point?.y == null
                  ? props.language.t("usage.noReading")
                  : format
                    ? format(point.y)
                    : point.y.toLocaleString(props.language.intl)}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
