/** @jsxImportSource react */
import { ProjectionChart } from "@reddb-io/design-system/data/ProjectionChart"
import type { SessionStatsInfo } from "@opencode/client/promise"
import type { SharedLanguage } from "@/runtime/react/language"

export default function CostProjection(props: {
  points: NonNullable<SessionStatsInfo["series"]>
  days: number
  language: SharedLanguage
}) {
  const day = 86_400_000
  const now = Date.now()
  const points = props.points
    .map((point) => ({ x: Date.parse(point.date), y: point.cost }))
    .filter((point) => Number.isFinite(point.x) && point.x <= now && Number.isFinite(point.y) && point.y >= 0)
    .sort((a, b) => a.x - b.x)
  if (!points.length) return null
  let total = 0
  const recorded = points.map((point) => ({ x: point.x, y: (total += point.y) }))
  const estimate = total + (total / props.days) * 7
  const money = (value: number) =>
    new Intl.NumberFormat(props.language.intl, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(
      value,
    )
  return (
    <ProjectionChart
      label={props.language.t("usage.projection.title")}
      value={money(estimate)}
      context={props.language.t("usage.projection.context")}
      recorded={[...recorded, { x: now, y: total }]}
      projected={[
        { x: now, y: total },
        { x: now + 7 * day, y: estimate },
      ]}
      now={now}
      valueDomain={[0, Math.max(estimate * 1.1, 0.01)]}
      nowLabel={props.language.t("usage.projection.now")}
      recordedLabel={props.language.t("usage.projection.recorded")}
      projectedLabel={props.language.t("usage.projection.projected")}
      formatValue={money}
      formatTime={(value) => new Date(value).toLocaleDateString(props.language.intl, { timeZone: "UTC" })}
    />
  )
}
