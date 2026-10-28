"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Skeleton } from "@reddb-io/design-system/base";
import { tokenColor } from "@reddb-io/design-system/base/recipes";
import {
  useRef
} from "react";
import {
  CATEGORY_AXIS_GUTTER_PX,
  CHART_ROWS,
  bandLabelCount,
  valueAxisGutter
} from "../../src/chart.js";
import { chartFigure } from "../../src/chart.variants.js";
import {
  useChartEngine,
  useChartLoading,
  useChartRhythm,
  useElementBox
} from "./chart-state.js";
let pending;
const importPlot = () => import("./HistogramPlot.js");
const loadPlot = () => pending ??= importPlot();
import { histogramBins } from "../../src/core/histogram.js";
export * from "../../src/core/histogram.js";
function Histogram(props) {
  const {
    values,
    bins = 10,
    label = "Histogram",
    format,
    series = 1,
    color,
    width,
    height,
    size = "lg",
    loading = "lazy",
    className = ""
  } = props;
  const figure = useRef(null), probe = useRef(null), box = useElementBox(figure), rhythm = useChartRhythm(probe), wanted = useChartLoading(figure, loading), chart = { Engine: useChartEngine(wanted, loadPlot) };
  const FALLBACK_WIDTH = 640;
  const ROWS = CHART_ROWS[size];
  const BAND_PADDING = 0.08;
  const COUNT_TICK_SPACING = 50;
  const data = histogramBins(values, bins, format);
  const largestCount = data.reduce(
    (largest, bin) => Math.max(largest, bin.count),
    0
  );
  const drawingWidth = width ?? (box && box.width > 0 ? Math.floor(box.width) : FALLBACK_WIDTH);
  const drawingHeight = height ?? Math.round(rhythm.row * ROWS);
  const padding = {
    top: rhythm.inset,
    right: rhythm.inset,
    bottom: CATEGORY_AXIS_GUTTER_PX,
    left: valueAxisGutter([String(largestCount)])
  };
  const countTickCount = Math.max(
    2,
    Math.round(
      (drawingHeight - padding.top - padding.bottom) / COUNT_TICK_SPACING
    )
  );
  const countTicks = (scale) => (scale.ticks?.(countTickCount) ?? []).filter(
    (tick) => typeof tick === "number" && Number.isInteger(tick)
  );
  const binTicks = bandLabelCount(
    data.map((bin) => bin.label),
    drawingWidth - padding.left - padding.right
  );
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "figure",
    {
      ref: figure,
      "data-ds-chart": true,
      "aria-busy": !chart.Engine || void 0,
      "data-chart-loaded": chart.Engine ? "" : void 0,
      "data-chart-kind": "histogram",
      "data-chart-series": series,
      "data-chart-width": width === void 0 ? "fluid" : "fixed",
      role: "img",
      "aria-label": label,
      style: { "--color-primary": tokenColor(color, `var(--reddb-color-series-${series})`) },
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
              data,
              width: drawingWidth,
              height: drawingHeight,
              padding,
              bandPadding: BAND_PADDING,
              countTicks,
              binTicks
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
            },
            children: /* @__PURE__ */ jsx(Skeleton, { shape: "column", className: "h-full max-w-none" })
          }
        ) })
      ]
    }
  ) });
}
var Histogram_default = Histogram;
export {
  Histogram,
  Histogram_default as default
};
