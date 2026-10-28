"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { Skeleton } from "@reddb-io/design-system/base";
import { tokenColor } from "@reddb-io/design-system/base/recipes";
import { useRef } from "react";
import { chartFigure } from "../../src/chart.variants.js";
import {
  useChartEngine,
  useChartLoading,
  useChartRhythm,
  useElementBox
} from "./chart-state.js";
let pending;
const importPlot = () => import("./SparklinePlot.js");
const loadPlot = () => pending ??= importPlot();
function Sparkline({
  values,
  label = "Trend",
  strokeWidth = 2,
  series = 1,
  color,
  variant = "line",
  curve = "smooth",
  width,
  height,
  loading = "lazy",
  className = ""
}) {
  const figure = useRef(null), probe = useRef(null), box = useElementBox(figure), rhythm = useChartRhythm(probe), wanted = useChartLoading(figure, loading), Plot = useChartEngine(wanted, loadPlot), rows = 1.5;
  const drawingWidth = width ?? (box && box.width > 0 ? Math.floor(box.width) : 160), drawingHeight = height ?? Math.round(rhythm.row * rows);
  const placeholder = /* @__PURE__ */ jsx(
    "div",
    {
      "data-chart-placeholder": true,
      "aria-hidden": "true",
      className: "max-w-full",
      style: {
        height: height === void 0 ? `calc(var(--reddb-spatial-control-height-md) * ${rows})` : `${height}px`,
        width: width === void 0 ? "100%" : `${width}px`
      },
      children: /* @__PURE__ */ jsx(Skeleton, { shape: variant === "bar" ? "column" : variant, className: "h-full max-w-none" })
    }
  );
  return /* @__PURE__ */ jsxs(
    "figure",
    {
      ref: figure,
      "data-ds-chart": true,
      "aria-busy": !Plot || void 0,
      "data-chart-loaded": Plot ? "" : void 0,
      "data-chart-kind": "sparkline",
      "data-chart-variant": variant,
      "data-chart-series": series,
      "data-chart-width": width === void 0 ? "fluid" : "fixed",
      role: "img",
      "aria-label": label,
      style: { "--color-primary": tokenColor(color, `var(--reddb-color-series-${series})`) },
      className: chartFigure({
        series,
        fluid: width === void 0,
        class: `${width === void 0 ? "block w-full" : "inline-block max-w-full"} ${className}`
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
        Plot ? /* @__PURE__ */ jsx(
          Plot,
          {
            strokeWidth,
            data: values.map((y, x) => ({ x, y })),
            curve,
            variant,
            width: drawingWidth,
            height: drawingHeight
          }
        ) : placeholder
      ]
    }
  );
}
var Sparkline_default = Sparkline;
export {
  Sparkline,
  Sparkline_default as default
};
