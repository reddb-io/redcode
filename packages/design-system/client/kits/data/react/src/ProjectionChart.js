"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import CompositeChart from "./CompositeChart.js";
import { projectionChartModel } from "../../src/projection-chart.js";
import { projectionChart } from "../../src/projection-chart.variants.js";
function ProjectionChart(props) {
  const { label, value, context, metrics = [], annotations = [], valueDomain, nowLabel = "Now", recordedLabel = "Recorded", projectedLabel = "Projected", series = 1, formatValue = String, formatTime = String, className = "" } = props;
  const model = projectionChartModel({ ...props, nowLabel, recordedLabel, projectedLabel, series }), styles = projectionChart();
  return /* @__PURE__ */ jsxs("section", { "data-projection-chart": true, "aria-label": label, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("p", { className: styles.label(), children: label }),
        /* @__PURE__ */ jsxs("p", { className: styles.headline(), children: [
          value,
          " ",
          context && /* @__PURE__ */ jsx("span", { className: styles.context(), children: context })
        ] })
      ] }),
      /* @__PURE__ */ jsx("dl", { className: styles.metrics(), children: metrics.map((metric, i) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { className: styles.metricLabel(), children: metric.label }),
        /* @__PURE__ */ jsx("dd", { className: styles.metricValue(), children: metric.value })
      ] }, i)) })
    ] }),
    /* @__PURE__ */ jsx(CompositeChart, { label, data: model.data, references: model.references, primaryAxis: { label, domain: valueDomain, format: formatValue }, formatX: (x) => formatTime(Number(x)), expandable: false, layout: "dense", readout: "overlay", size: "md" }),
    annotations.length > 0 && /* @__PURE__ */ jsx("ul", { "aria-label": `${label} annotations`, className: styles.annotations(), children: annotations.map((annotation) => /* @__PURE__ */ jsxs("li", { children: [
      annotation.label,
      ": ",
      formatTime(annotation.time)
    ] }, annotation.id)) })
  ] });
}
var ProjectionChart_default = ProjectionChart;
export {
  ProjectionChart,
  ProjectionChart_default as default
};
