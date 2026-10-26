"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import {
  Button,
  Dialog,
  Icon,
  quietControl,
  useControllableValue
} from "@reddb-io/design-system/base";
import TimeSeries from "./TimeSeries.js";
import Table from "./Table.js";
import { formatChartNumber } from "../../src/chart.js";
import { timeSeriesDatasets } from "../../src/time-series.js";
import { metricStatistics } from "../../src/metric.js";
function MetricChart(props) {
  const {
    label,
    data,
    timeRange,
    activeX: suppliedActiveX = null,
    onActiveXChange,
    layout = "roomy",
    readout = "auto",
    description,
    aggregate = "total",
    format = formatChartNumber,
    formatX,
    variant = "bar",
    curve = "smooth",
    presentation = "summary",
    size,
    height,
    detailHref,
    detailLabel = "Explore",
    expandable = true,
    expandIcon,
    expanded: initialExpanded = false,
    hiddenSeries: initialHiddenSeries = [],
    onExpandedChange,
    onHiddenSeriesChange,
    className = ""
  } = props;
  const [activeX, setActiveX] = useControllableValue(props.activeX === void 0 ? void 0 : suppliedActiveX === null ? null : +suppliedActiveX, null, onActiveXChange);
  const [expanded, setExpanded] = useControllableValue(
    props.expanded,
    initialExpanded,
    onExpandedChange
  ), [hiddenSeries, setHiddenSeries] = useControllableValue(
    props.hiddenSeries,
    initialHiddenSeries,
    onHiddenSeriesChange
  );
  const resolved = timeSeriesDatasets(data, label, 1), statistics = metricStatistics(resolved), observed = statistics.filter((row) => row.count > 0), headline = observed.length ? aggregate === "average" ? observed.reduce((sum, row) => sum + (row.total ?? 0), 0) / observed.reduce((sum, row) => sum + row.count, 0) : observed.reduce((sum, row) => sum + (row[aggregate] ?? 0), 0) : null;
  const reading = (value) => typeof value === "number" ? format(value) : "No samples";
  const columns = [
    { key: "label", header: "Series", sortable: true },
    ...[
      ["min", "Min"],
      ["max", "Max"],
      ["average", "Average"],
      ["total", "Total"]
    ].map(([key, header]) => ({
      key,
      header,
      sortable: true,
      align: "end",
      format: reading
    }))
  ];
  const toggle = (id) => setHiddenSeries(
    hiddenSeries.includes(id) ? hiddenSeries.filter((value) => value !== id) : [...hiddenSeries, id]
  ), openDetails = () => setExpanded(true);
  const seriesCell = ({ row, column, text }) => column.key === "label" ? /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-[var(--reddb-spatial-gap-sm)]", children: [
    /* @__PURE__ */ jsx(
      "span",
      {
        "aria-hidden": "true",
        className: "size-[var(--reddb-spatial-gap-md)] shrink-0 rounded-full",
        style: { background: String(row.paint) }
      }
    ),
    text
  ] }) : text;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs(
      "section",
      {
        "data-metric-chart": true,
        "data-metric-presentation": presentation,
        "aria-label": label,
        className: `flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-sm)] rounded-lg border border-muted bg-elevation-raised-surface p-[var(--reddb-spatial-inset-md)] text-foreground ${className}`,
        children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              className: "flex min-w-0 items-start justify-between gap-[var(--reddb-spatial-gap-md)]",
              children: [
                /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                  /* @__PURE__ */ jsx("p", { className: "m-0 text-caption text-ink-muted", children: label }),
                  /* @__PURE__ */ jsx("p", { "data-metric-value": true, className: "m-0 text-title tabular-nums", children: reading(headline) }),
                  description ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 text-caption text-ink-muted", children: description }) }) : null
                ] }),
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    className: "flex shrink-0 items-center gap-[var(--reddb-spatial-gap-sm)]",
                    children: [
                      detailHref ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(Button, { href: detailHref, variant: "ghost", size: "sm", children: detailLabel }) }) : null,
                      expandable ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        Button,
                        {
                          variant: "ghost",
                          size: "sm",
                          "aria-label": `Expand ${label}`,
                          title: `Expand ${label}`,
                          onClick: openDetails,
                          children: expandIcon ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(Icon, { icon: expandIcon, size: "sm" }) }) : /* @__PURE__ */ jsx(Fragment, { children: "Expand" })
                        }
                      ) }) : null
                    ]
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            TimeSeries,
            {
              data,
              timeRange,
              activeX,
              onActiveXChange: setActiveX,
              label,
              layout,
              readout,
              variant,
              curve,
              format,
              formatX,
              height,
              size: size ?? (presentation === "summary" ? "sm" : "md"),
              presentation: presentation === "summary" ? "minimal" : "full",
              interactive: presentation === "full",
              hiddenSeries,
              onHiddenSeriesChange: setHiddenSeries,
              className: "p-0"
            }
          ),
          presentation === "summary" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
            "div",
            {
              "data-metric-legend": true,
              className: "grid gap-[var(--reddb-spatial-gap-sm)]",
              "aria-label": `${label} series`,
              children: [
                statistics.map((row, index) => {
                  return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                    "button",
                    {
                      type: "button",
                      "aria-pressed": !hiddenSeries.includes(row.id),
                      "data-metric-series": row.id,
                      className: quietControl({
                        ink: "foreground",
                        class: "flex min-w-0 min-h-[var(--reddb-spatial-control-height-sm)] items-center gap-[var(--reddb-spatial-gap-md)] rounded-md text-caption"
                      }),
                      onClick: () => toggle(row.id),
                      children: [
                        /* @__PURE__ */ jsx(
                          "span",
                          {
                            "aria-hidden": "true",
                            className: `size-[var(--reddb-spatial-gap-md)] shrink-0 rounded-full border border-current ${hiddenSeries.includes(row.id) ? "bg-transparent" : "bg-current"}`,
                            style: { color: row.paint }
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "span",
                          {
                            className: `min-w-0 flex-1 text-start ${hiddenSeries.includes(row.id) ? "text-ink-muted" : ""}`,
                            children: row.label
                          }
                        ),
                        /* @__PURE__ */ jsx("span", { className: "shrink-0 text-ink-muted tabular-nums", children: reading(row[aggregate]) })
                      ]
                    }
                  ) }, row.id);
                }),
                statistics.length === 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 text-caption text-ink-muted", children: "No samples in this period." }) }) : null,
                statistics.length > 0 && statistics.every((row) => hiddenSeries.includes(row.id)) ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 text-caption text-ink-muted", children: "All series hidden. Use the legend to restore them." }) }) : null
              ]
            }
          ) }) : null
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      Dialog,
      {
        title: label,
        description,
        size: "xl",
        open: expanded,
        onOpenChange: setExpanded,
        children: expanded ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "div",
          {
            "data-metric-detail": true,
            className: "grid min-w-0 gap-[var(--reddb-spatial-layout-gap-md)]",
            children: [
              /* @__PURE__ */ jsx(
                TimeSeries,
                {
                  data,
                  timeRange,
                  activeX,
                  onActiveXChange: setActiveX,
                  label,
                  layout,
                  readout,
                  variant,
                  curve,
                  format,
                  formatX,
                  size: "lg",
                  hiddenSeries,
                  onHiddenSeriesChange: setHiddenSeries
                }
              ),
              /* @__PURE__ */ jsx(
                Table,
                {
                  caption: `${label}: observed sample statistics`,
                  columns,
                  rows: statistics,
                  rowKey: "id",
                  cell: seriesCell
                }
              )
            ]
          }
        ) }) : null
      }
    )
  ] });
}
var MetricChart_default = MetricChart;
export {
  MetricChart,
  MetricChart_default as default
};
