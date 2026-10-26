import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useControllableValue } from "@reddb-io/design-system/base";
import { CompositeChart } from "./CompositeChart.js";
import { formatChartNumber } from "../../src/chart.js";
import { barModel } from "../../src/core/bar-chart.js";
function BarChart(props) {
  const { data, series, sort = "input", category, hiddenSeries: initialHiddenSeries = [], expanded: initialExpanded = false, activeX: initialActiveX = null, ...rest } = props;
  const [hiddenSeries, setHiddenSeries] = useControllableValue(props.hiddenSeries, initialHiddenSeries, props.onHiddenSeriesChange);
  const [expanded, setExpanded] = useControllableValue(props.expanded, initialExpanded, props.onExpandedChange);
  const [activeX, setActiveX] = useControllableValue(props.activeX === void 0 ? void 0 : props.activeX === null ? null : +props.activeX, initialActiveX === null ? null : +initialActiveX, props.onActiveXChange);
  const model = barModel(data, series, sort, rest.palette);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(CompositeChart, { ...rest, hiddenSeries, onHiddenSeriesChange: setHiddenSeries, expanded, onExpandedChange: setExpanded, activeX, onActiveXChange: (value) => setActiveX(value), data: model.layers, formatX: model.formatX }),
    category && /* @__PURE__ */ jsx("div", { "aria-label": `${rest.label} categories`, className: "flex min-w-0 flex-wrap gap-[var(--reddb-spatial-gap-md)]", children: model.categories.map((item) => /* @__PURE__ */ jsx("div", { className: "min-w-0", children: category(item) }, item.id)) }),
    /* @__PURE__ */ jsxs("details", { className: "text-caption", children: [
      /* @__PURE__ */ jsxs("summary", { className: "min-h-[var(--reddb-spatial-control-height-sm)] content-center focus-visible:outline-2 focus-visible:outline-focus", children: [
        "Explore data (",
        model.categories.length,
        ")"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "min-w-0 overflow-x-auto", children: /* @__PURE__ */ jsxs("table", { className: "w-full text-start", children: [
        /* @__PURE__ */ jsxs("caption", { className: "sr-only", children: [
          rest.label,
          " data"
        ] }),
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { scope: "col", children: "Category" }),
          series?.length ? series.map((item) => /* @__PURE__ */ jsx("th", { scope: "col", children: item.label }, item.id)) : /* @__PURE__ */ jsx("th", { scope: "col", children: "Value" })
        ] }) }),
        /* @__PURE__ */ jsx("tbody", { children: model.categories.map((item) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { scope: "row", children: item.label }),
          series?.length ? series.map((contribution) => /* @__PURE__ */ jsx("td", { children: item.values?.[contribution.id] == null ? "No sample" : (rest.primaryAxis?.format ?? formatChartNumber)(item.values[contribution.id]) }, contribution.id)) : /* @__PURE__ */ jsx("td", { children: item.value == null ? "No sample" : (rest.primaryAxis?.format ?? formatChartNumber)(item.value) })
        ] }, item.id)) })
      ] }) })
    ] })
  ] });
}
var BarChart_default = BarChart;
export {
  BarChart,
  BarChart_default as default
};
