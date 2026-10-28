"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Skeleton } from "@reddb-io/design-system/base";
import { compositeSkeletonShape } from "../../src/core/chart-skeleton.js";
import { useId, useMemo, useRef, useState } from "react";
import { quietControl } from "@reddb-io/design-system/base";
import { chartSurface, chartReadout, chartRows, chartHeightStyle, chartAdaptiveHeight } from "../../src/chart-layout.variants.js";
import { chartTimeIndex, chartCursor } from "../../src/core/chart-time.js";
import { compositeChart } from "../../src/composite-chart.variants.js";
import { compositeLayout, compositeNearest, compositeKey, compositeInspection } from "../../src/core/composite-chart.js";
import { useChartEngine, useChartLoading, useChartRhythm, useElementBox } from "./chart-state.js";
let pending;
const importPlot = () => import("./CompositeChartPlot.js");
const loadPlot = () => pending ??= importPlot();
function CompositeChartPanel({ model, label, layoutMode, readoutMode, orientation, primaryAxis, secondaryAxis, formatX, presentation, legend, interactive, hiddenSeries, activeX, onActiveChange, onToggle, size, height, fill = false, loading, actions }) {
  const uid = useId();
  const styles = compositeChart(), figure = useRef(null), plot = useRef(null), probe = useRef(null);
  const box = useElementBox(plot), rhythm = useChartRhythm(probe), wanted = useChartLoading(figure, loading), Engine = useChartEngine(wanted, loadPlot);
  const [keyboard, setKeyboard] = useState(false);
  const fills = fill || height === "fill";
  const drawingWidth = Math.max(1, box?.width ? Math.floor(box.width) : 640), drawingHeight = Math.max(1, box?.height ? Math.floor(box.height) : typeof height === "number" ? height : rhythm.row * chartRows(layoutMode, 10, size));
  const layout = useMemo(() => compositeLayout(model, drawingWidth, drawingHeight, orientation === "horizontal", presentation, primaryAxis, secondaryAxis, formatX), [model, drawingWidth, drawingHeight, orientation, presentation, primaryAxis, secondaryAxis, formatX]);
  const inspection = compositeInspection(model, hiddenSeries, chartTimeIndex(model.samples, activeX, (sample) => sample.key), primaryAxis, secondaryAxis, formatX, legend === "compact");
  function pointer(event) {
    if (!interactive || !model.samples.length) return;
    const rect = event.currentTarget.getBoundingClientRect(), horizontal = orientation === "horizontal";
    const position = horizontal ? event.clientY - rect.top - layout.padding.top : event.clientX - rect.left - layout.padding.left;
    const fraction = Math.max(0, Math.min(1, position / (horizontal ? layout.plotHeight : layout.plotWidth)));
    setKeyboard(false);
    onActiveChange(model.samples[compositeNearest(model.samples, model.sampleDomain[0] + fraction * (model.sampleDomain[1] - model.sampleDomain[0]))].key);
  }
  function key(event) {
    if (!interactive) return;
    if (event.key === "Escape") {
      onActiveChange(null);
      return;
    }
    const next = compositeKey(event.key, inspection.index, model.samples.length);
    if (next === void 0) return;
    event.preventDefault();
    setKeyboard(true);
    onActiveChange(model.samples[next].key);
  }
  return /* @__PURE__ */ jsxs(
    "figure",
    {
      ref: figure,
      "data-ds-chart": true,
      "data-chart-kind": "composite-chart",
      "data-chart-orientation": orientation,
      "data-chart-inspecting": chartCursor(activeX, model.sampleDomain) !== void 0 ? "" : void 0,
      "data-chart-presentation": presentation,
      "data-chart-layout": layoutMode,
      "data-chart-readout": readoutMode,
      "aria-busy": !Engine || void 0,
      "data-chart-loaded": Engine ? "" : void 0,
      role: "group",
      "aria-label": label,
      "aria-describedby": model.references.length ? `${uid}-references` : void 0,
      className: `${styles.panel()} ${chartSurface({ fill: fills })}`,
      children: [
        /* @__PURE__ */ jsxs("span", { id: `${uid}-references`, className: "sr-only", children: [
          "References: ",
          model.references.map((reference) => reference.label).join(", ")
        ] }),
        /* @__PURE__ */ jsx("span", { id: `${uid}-help`, className: "sr-only", children: "Use arrow keys to inspect samples. Home and End select the first and last sample." }),
        /* @__PURE__ */ jsx("span", { ref: probe, "aria-hidden": "true", className: "pointer-events-none invisible absolute start-0 top-0 h-[var(--reddb-spatial-control-height-md)] w-[var(--reddb-spatial-inset-sm)]" }),
        (legend === "compact" || actions || primaryAxis || secondaryAxis) && /* @__PURE__ */ jsxs("div", { className: styles.toolbar(), children: [
          legend === "compact" && /* @__PURE__ */ jsx("div", { "data-chart-legend": true, "aria-label": `${label} series`, className: styles.legend(), children: model.series.map((series) => /* @__PURE__ */ jsxs("button", { type: "button", "data-chart-legend-item": series.id, "aria-pressed": !hiddenSeries.includes(series.id), className: quietControl({ ink: "foreground", class: styles.legendItem() }), onClick: () => onToggle(series.id), children: [
            /* @__PURE__ */ jsx("svg", { "aria-hidden": "true", viewBox: "0 0 16 12", className: `${styles.swatch()} h-[1em]`, children: series.kind === "candlestick" ? /* @__PURE__ */ jsx("path", { d: "M8 0V12M4 3H12V9H4Z", stroke: series.paint, fill: "none" }) : series.kind === "column" ? /* @__PURE__ */ jsx("rect", { x: "3", y: "2", width: "10", height: "8", fill: series.paint }) : /* @__PURE__ */ jsx("line", { x1: "0", x2: "16", y1: "6", y2: "6", stroke: series.paint, strokeWidth: "2", strokeDasharray: series.dash }) }),
            /* @__PURE__ */ jsx("span", { children: series.label })
          ] }, series.id)) }),
          /* @__PURE__ */ jsxs("div", { "data-chart-axis-key": true, className: styles.axes(), children: [
            primaryAxis && /* @__PURE__ */ jsxs(Fragment, { children: [
              primaryAxis.label,
              " (",
              orientation === "vertical" ? "left" : "bottom",
              ")"
            ] }),
            secondaryAxis && /* @__PURE__ */ jsxs(Fragment, { children: [
              primaryAxis ? " \xB7 " : "",
              secondaryAxis.label,
              " (",
              orientation === "vertical" ? "right" : "top",
              ")"
            ] })
          ] }),
          actions
        ] }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            ref: plot,
            "data-chart-explorer": true,
            className: `${styles.plot()} ${fills ? "flex-1" : chartAdaptiveHeight(layoutMode, 10, size, height)}`,
            style: { height: fills ? void 0 : chartHeightStyle(layoutMode, 10, size, height) },
            role: interactive ? "slider" : void 0,
            tabIndex: interactive && model.samples.length ? 0 : void 0,
            "aria-label": interactive ? `Explore ${label}` : void 0,
            "aria-orientation": interactive ? orientation === "horizontal" ? "vertical" : "horizontal" : void 0,
            "aria-describedby": interactive ? `${uid}-help` : void 0,
            "aria-valuemin": interactive ? 0 : void 0,
            "aria-valuemax": interactive ? Math.max(0, model.samples.length - 1) : void 0,
            "aria-valuenow": interactive ? inspection.index : void 0,
            "aria-valuetext": interactive ? inspection.announcement : void 0,
            onPointerMove: pointer,
            onPointerDown: pointer,
            onKeyDown: key,
            onBlur: () => setKeyboard(false),
            children: [
              Engine ? /* @__PURE__ */ jsx(Engine, { model, layout, hiddenSeries, presentation, cursor: interactive ? chartCursor(activeX, model.sampleDomain) : void 0 }) : /* @__PURE__ */ jsx("div", { "data-chart-placeholder": true, "aria-hidden": "true", className: "h-full w-full", children: /* @__PURE__ */ jsx(Skeleton, { shape: compositeSkeletonShape(model, orientation), className: "h-full max-w-none" }) }),
              inspection.empty && /* @__PURE__ */ jsx("div", { "data-composite-empty": true, className: styles.empty(), children: inspection.empty })
            ]
          }
        ),
        interactive && /* @__PURE__ */ jsxs("div", { "data-chart-tooltip": true, "aria-live": keyboard ? "polite" : "off", className: readoutMode === "hidden" ? "sr-only" : `${styles.readout()} ${chartReadout(layoutMode, readoutMode)}`, children: [
          /* @__PURE__ */ jsx("span", { "data-chart-sample": true, children: inspection.sampleLabel }),
          inspection.readings.map((reading) => /* @__PURE__ */ jsxs("span", { "data-chart-reading": reading.id, children: [
            reading.label,
            " ",
            /* @__PURE__ */ jsx("strong", { className: "font-medium text-foreground", children: reading.value })
          ] }, reading.id))
        ] })
      ]
    }
  );
}
export {
  CompositeChartPanel as default
};
