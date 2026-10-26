/** @jsxImportSource react */
import { useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Select } from "@reddb-io/design-system/base/Select"
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
  const points = view.data?.series ?? []
  const tokens = (value: NonNullable<typeof view.data>["tokens"]) =>
    value.input + value.output + value.reasoning + value.cache.read + value.cache.write
  const money = (value: number) =>
    new Intl.NumberFormat(language.intl, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
  const date = (value: string | number | Date) => new Date(value).toLocaleDateString(language.intl, { timeZone: "UTC" })
  const models = view.data?.models ?? []
  const charts = [
    {
      id: "steps",
      label: language.t("usage.steps"),
      data: points.map((point) => ({ x: Date.parse(point.date), y: point.steps })),
    },
    {
      id: "tokens",
      label: language.t("usage.tokens"),
      data: points.map((point) => ({ x: Date.parse(point.date), y: tokens(point.tokens) })),
    },
    {
      id: "cost",
      label: language.t("usage.cost"),
      data: points.map((point) => ({ x: Date.parse(point.date), y: point.cost })),
    },
  ]
  const range =
    points.length > 1 ? ([Date.parse(points[0]!.date), Date.parse(points.at(-1)!.date)] as const) : undefined
  return (
    <div className="flex min-w-0 flex-col gap-4 text-body">
      <p className="max-w-prose text-ink-muted">{language.t("usage.coverage")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          {language.t("usage.period")}
          <Select
            aria-label={language.t("usage.period")}
            value={String(view.days)}
            onValueChange={(value) => props.services.selectDays(value === "30" ? 30 : 7)}
            options={[
              { value: "7", label: language.t("usage.sevenDays") },
              { value: "30", label: language.t("usage.thirtyDays") },
            ]}
          />
        </label>
        <label>
          {language.t("usage.project")}
          <Select
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
        </label>
        <Button variant="secondary" disabled={!view.connected} onClick={props.services.refresh}>
          {language.t("agentTasks.refresh")}
        </Button>
      </div>
      {view.projectsError && <p role="status">{language.t("usage.projectsUnavailable")}</p>}
      {(!view.connected || view.error) && <p role="alert">{language.t("usage.unavailable")}</p>}
      {view.loading && <p role="status">{language.t("common.loading")}</p>}
      {view.data && (
        <>
          <p>
            {language.t("usage.totals", {
              cost: money(view.data.cost),
              tokens: tokens(view.data.tokens).toLocaleString(language.intl),
            })}
          </p>
          <p className="text-ink-muted">
            {language.t("usage.provenance", {
              reported: view.data.costCoverage?.reported ?? 0,
              estimated: view.data.costCoverage?.estimated ?? 0,
              unknown: view.data.costCoverage?.unknown ?? 0,
              legacy: view.data.costCoverage?.legacy ?? 0,
            })}
          </p>
          <ErrorBoundary
            title={language.t("usage.chartError")}
            retryLabel={language.t("common.retry")}
            resetKey={`${view.project}:${view.days}`}
          >
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {charts.map((chart) => (
                <CompositeChart
                  key={chart.id}
                  label={chart.label}
                  layout="auto"
                  size="sm"
                  activeX={activeX}
                  onActiveXChange={setActiveX}
                  timeRange={range}
                  expandLabel={language.t("agents.chart.expand")}
                  restoreLabel={language.t("common.close")}
                  formatX={date}
                  primaryAxis={{ label: chart.label, ...(chart.id === "cost" ? { format: money } : {}) }}
                  data={[{ ...chart, kind: "column" }]}
                />
              ))}
              <CompositeChart
                label={language.t("usage.models")}
                layout="auto"
                size="sm"
                activeX={activeX}
                onActiveXChange={setActiveX}
                timeRange={range}
                expandLabel={language.t("agents.chart.expand")}
                restoreLabel={language.t("common.close")}
                formatX={date}
                primaryAxis={{ label: language.t("usage.cost"), format: money }}
                data={[
                  ...models.map((model) => ({
                    id: `${model.model.providerID}/${model.model.id}#${model.model.variant ?? ""}`,
                    label: `${model.model.providerID}/${model.model.id}${model.model.variant ? ` (${model.model.variant})` : ""}`,
                    kind: "line" as const,
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
                    kind: "line",
                    data: points.map((point) => ({
                      x: Date.parse(point.date),
                      y: Math.max(0, point.cost - point.models.reduce((sum, item) => sum + item.cost, 0)),
                    })),
                  },
                ]}
              />
            </div>
          </ErrorBoundary>
          {!points.length && <p role="status">{language.t("usage.empty")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-start tabular-nums">
              <caption className="text-start">{language.t("usage.daily")}</caption>
              <thead>
                <tr>
                  {["date", "steps", "tokens", "cost", "unknown"].map((key) => (
                    <th key={key} scope="col" className="p-2 text-start">
                      {language.tDynamic(`usage.${key}`, key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row" className="p-2 text-start">
                      {date(point.date)}
                    </th>
                    <td className="p-2">{point.steps}</td>
                    <td className="p-2">{tokens(point.tokens)}</td>
                    <td className="p-2">{money(point.cost)}</td>
                    <td className="p-2">{point.costCoverage.unknown + point.costCoverage.legacy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
