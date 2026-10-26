"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  useRef
} from "react";
import {
  heatmapStep
} from "../../src/chart.js";
import { chartFigure } from "../../src/chart.variants.js";
import {
  useChartEngine,
  useChartLoading,
  useChartRhythm,
  useElementBox
} from "./chart-state.js";
let pending;
const importPlot = () => import("./HeatmapPlot.js");
const loadPlot = () => pending ??= importPlot();
export * from "../../src/core/heatmap.js";
function Heatmap(props) {
  const {
    data,
    start,
    end,
    label = "Heatmap",
    series = 1,
    width,
    height,
    loading = "lazy",
    className = ""
  } = props;
  const figure = useRef(null), probe = useRef(null), box = useElementBox(figure), rhythm = useChartRhythm(probe), wanted = useChartLoading(figure, loading), chart = { Engine: useChartEngine(wanted, loadPlot) };
  const FALLBACK_WIDTH = 640;
  const ROWS = 5;
  const drawingWidth = width ?? (box && box.width > 0 ? Math.floor(box.width) : FALLBACK_WIDTH);
  const drawingHeight = height ?? Math.round(rhythm.row * ROWS);
  const dayOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const valueByDay = (() => {
    const totals = /* @__PURE__ */ new Map();
    for (const point of data) {
      if (!Number.isFinite(point.value) || Number.isNaN(point.date.valueOf()))
        continue;
      const day = dayOf(point.date);
      totals.set(day, (totals.get(day) ?? 0) + point.value);
    }
    return totals;
  })();
  const maximum = (() => {
    const [first, last] = [dayOf(start), end.valueOf()];
    let largest = 0;
    for (const [day, value] of valueByDay) {
      if (day >= first && day < last) largest = Math.max(largest, value);
    }
    return largest;
  })();
  const stepOf = (date) => heatmapStep(valueByDay.get(dayOf(date)), maximum);
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "figure",
    {
      ref: figure,
      "data-ds-chart": true,
      "data-chart-loaded": chart.Engine ? "" : void 0,
      "data-chart-kind": "heatmap",
      "data-chart-series": series,
      "data-chart-width": width === void 0 ? "fluid" : "fixed",
      role: "img",
      "aria-label": label,
      className: chartFigure({
        series,
        fluid: width === void 0,
        class: `w-full overflow-hidden rounded-lg ${className}`
      }),
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            ref: probe,
            "data-chart-rhythm-probe": true,
            "aria-hidden": "true",
            className: "pointer-events-none invisible absolute start-0 top-0 h-[var(--reddb-spatial-control-height-md)] w-[var(--reddb-spatial-inset-sm)]"
          }
        ),
        chart.Engine ? (() => {
          const Engine = chart.Engine;
          return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
            Engine,
            {
              start,
              end,
              stepOf,
              width: drawingWidth,
              height: drawingHeight
            }
          ) });
        })() : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
          "div",
          {
            "data-chart-placeholder": true,
            "aria-hidden": "true",
            className: "w-full",
            style: {
              height: height === void 0 ? `calc(var(--reddb-spatial-control-height-md) * ${ROWS})` : `${height}px`
            }
          }
        ) })
      ]
    }
  ) });
}
var Heatmap_default = Heatmap;
export {
  Heatmap,
  Heatmap_default as default
};
