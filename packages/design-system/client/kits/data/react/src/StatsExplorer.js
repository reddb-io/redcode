import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { quietControl } from "@reddb-io/design-system/base";
import KpiCard from "./KpiCard.js";
import Table from "./Table.js";
import { formatStatsMetric, statsGaugePercent } from "../../src/stats-explorer.js";
import { statsExplorerClasses as styles } from "../../src/stats-explorer.variants.js";
import { formatStatsMetric as formatStatsMetric2, statsGaugePercent as statsGaugePercent2 } from "../../src/stats-explorer.js";
function StatsExplorer({ label, metrics, context, emptyLabel = "No numeric statistics in this result.", className = "" }) {
  const [mode, setMode] = useState("kpi");
  const columns = [{ key: "label", header: "Metric" }, { key: "value", header: "Value", align: "end" }, { key: "unit", header: "Unit" }];
  const rows = metrics.map((metric, id) => ({ id, label: metric.label, value: metric.value.toLocaleString(), unit: metric.unit || "-" }));
  const maximum = metrics.reduce((max, metric) => Math.max(max, Math.abs(metric.value)), 1);
  return /* @__PURE__ */ jsx("section", { "data-stats-explorer": true, "aria-label": label, className: `${styles.root} ${className}`, children: metrics.length === 0 ? /* @__PURE__ */ jsx("p", { className: styles.content, children: emptyLabel }) : /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
      [["kpi", "kpis"], ["gauge", "gauges"], ["table", "table"]].map(([value, text]) => /* @__PURE__ */ jsx("button", { type: "button", className: quietControl({ selected: mode === value, class: "px-[var(--reddb-spatial-inset-sm)]" }), "aria-pressed": mode === value, onClick: () => setMode(value), children: text }, value)),
      /* @__PURE__ */ jsxs("span", { children: [
        metrics.length.toLocaleString(),
        " metrics"
      ] }),
      context && /* @__PURE__ */ jsx("span", { className: "text-ink-muted", children: context })
    ] }),
    mode === "table" ? /* @__PURE__ */ jsx(Table, { caption: label, captionHidden: true, columns, rows, rowKey: "id", pageSize: Math.max(1, rows.length), columnVisibility: false }) : /* @__PURE__ */ jsx("div", { className: styles.content, role: "region", "aria-label": `${label} values`, tabIndex: 0, children: /* @__PURE__ */ jsx("div", { className: styles.grid, children: metrics.map((metric, index) => mode === "kpi" ? /* @__PURE__ */ jsx(KpiCard, { label: metric.label, value: formatStatsMetric(metric.value, metric.unit) }, `${metric.key}-${index}`) : /* @__PURE__ */ jsxs("div", { className: styles.gauge, children: [
      /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 120 70", className: styles.svg, role: "img", "aria-label": `${metric.label} gauge`, children: [
        /* @__PURE__ */ jsx("path", { d: "M 15 60 A 45 45 0 0 1 105 60", fill: "none", stroke: "var(--reddb-color-muted)", strokeWidth: "10", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx("path", { d: "M 15 60 A 45 45 0 0 1 105 60", fill: "none", stroke: "var(--reddb-color-foreground)", strokeWidth: "10", strokeLinecap: "round", pathLength: "100", strokeDasharray: `${statsGaugePercent(metric.value, maximum)} 100` })
      ] }),
      /* @__PURE__ */ jsxs("p", { children: [
        metric.label,
        ": ",
        formatStatsMetric(metric.value, metric.unit)
      ] })
    ] }, `${metric.key}-${index}`)) }) })
  ] }) });
}
var StatsExplorer_default = StatsExplorer;
export {
  StatsExplorer,
  StatsExplorer_default as default,
  formatStatsMetric2 as formatStatsMetric,
  statsGaugePercent2 as statsGaugePercent
};
