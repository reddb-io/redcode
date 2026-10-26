"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { Button, Dialog, useControllableValue } from "@reddb-io/design-system/base";
import { resolveCompositeChart } from "../../src/core/composite-chart.js";
import { compositeChart } from "../../src/composite-chart.variants.js";
import Panel from "./CompositeChartPanel.js";
function CompositeChart(props) {
  const {
    data,
    label,
    timeRange,
    activeX: suppliedActiveX = null,
    onActiveXChange,
    layout = "roomy",
    readout = "auto",
    orientation = "vertical",
    primaryAxis,
    secondaryAxis,
    references = [],
    formatX,
    presentation = "full",
    legend = "compact",
    interactive = true,
    hiddenSeries: initialHiddenSeries = [],
    expandable = true,
    expanded: initialExpanded = false,
    expandLabel = "Maximize",
    restoreLabel = "Restore",
    size,
    height,
    loading = "lazy",
    onHiddenSeriesChange,
    onExpandedChange,
    className = ""
  } = props;
  const [hiddenSeries, setHiddenSeries] = useControllableValue(props.hiddenSeries, initialHiddenSeries, onHiddenSeriesChange);
  const [expanded, setExpanded] = useControllableValue(props.expanded, initialExpanded, onExpandedChange);
  const [activeX, setActiveX] = useControllableValue(props.activeX === void 0 ? void 0 : suppliedActiveX === null ? null : +suppliedActiveX, null, onActiveXChange);
  const styles = compositeChart();
  const model = useMemo(() => resolveCompositeChart(data, orientation, primaryAxis, secondaryAxis, references, timeRange), [data, orientation, primaryAxis, secondaryAxis, props.references, timeRange]);
  const panel = { model, label, layoutMode: layout, readoutMode: readout, orientation, primaryAxis, secondaryAxis, formatX, presentation, legend, interactive, hiddenSeries, activeX, size, height, loading };
  const toggle = (id) => setHiddenSeries(hiddenSeries.includes(id) ? hiddenSeries.filter((value) => value !== id) : [...hiddenSeries, id]);
  return /* @__PURE__ */ jsxs("section", { "data-composite-chart": true, "aria-label": label, className: styles.root({ class: `${height === "fill" ? "h-full" : ""} ${className}` }), children: [
    /* @__PURE__ */ jsx(Panel, { ...panel, onActiveChange: setActiveX, onToggle: toggle, actions: expandable ? /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", "aria-label": `${expandLabel} ${label}`, onClick: () => setExpanded(true), children: expandLabel }) : void 0 }),
    /* @__PURE__ */ jsx(
      Dialog,
      {
        title: label,
        size: "xl",
        open: expanded,
        onOpenChange: setExpanded,
        className: styles.dialog(),
        header: ({ close }) => /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
          /* @__PURE__ */ jsx("span", { className: "text-caption font-medium", children: label }),
          /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", onClick: close, children: restoreLabel })
        ] }),
        children: expanded && /* @__PURE__ */ jsx("div", { "data-composite-expanded": true, className: "h-full min-h-0", children: /* @__PURE__ */ jsx(Panel, { ...panel, fill: true, loading: "eager", onActiveChange: setActiveX, onToggle: toggle }) })
      }
    )
  ] });
}
var CompositeChart_default = CompositeChart;
export {
  CompositeChart,
  CompositeChart_default as default
};
