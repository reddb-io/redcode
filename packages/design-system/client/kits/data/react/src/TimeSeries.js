"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment as Fragment2,
  useMemo,
  useState,
  useRef
} from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import { quietControl } from "@reddb-io/design-system/base";
import {
  timeSeriesPadding,
  formatTimeSample,
  nearestTimeIndex,
  timeSeriesBars,
  timeSeriesDatasets,
  timeSeriesDomain,
  timeSeriesSamples,
  timeSeriesValueDomain
} from "../../src/time-series.js";
import {
  formatChartNumber
} from "../../src/chart.js";
import { chartTimeRange, chartTimeIndex, chartCursor } from "../../src/core/chart-time.js";
import { chartSurface, chartReadout, chartRows, chartHeightStyle, chartAdaptiveHeight } from "../../src/chart-layout.variants.js";
import { chartFigure } from "../../src/chart.variants.js";
import {
  useChartEngine,
  useChartLoading,
  useChartRhythm,
  useElementBox
} from "./chart-state.js";
let pending;
const importPlot = () => import("./TimeSeriesPlot.js");
const loadPlot = () => pending ??= importPlot();
function TimeSeries(props) {
  const {
    data,
    timeRange,
    activeX: suppliedActiveX = null,
    onActiveXChange,
    label = "Time series",
    variant = "line",
    curve = "smooth",
    presentation = "full",
    layout = "roomy",
    readout = "auto",
    size,
    hiddenSeries: initialHiddenSeries = [],
    onHiddenSeriesChange,
    format = (value) => formatChartNumber(value),
    formatX,
    valueDomain,
    interactive,
    series = 1,
    width,
    height,
    loading = "lazy",
    className = ""
  } = props;
  const figure = useRef(null), probe = useRef(null), plot = useRef(null), plotBox = useElementBox(plot), box = useElementBox(figure), rhythm = useChartRhythm(probe), wanted = useChartLoading(figure, loading), chart = { Engine: useChartEngine(wanted, loadPlot) };
  const [activeX, setActiveX] = useControllableValue(props.activeX === void 0 ? void 0 : suppliedActiveX === null ? null : +suppliedActiveX, null, onActiveXChange);
  const [keyboard, setKeyboard] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useControllableValue(
    props.hiddenSeries,
    initialHiddenSeries,
    props.onHiddenSeriesChange
  );
  const FALLBACK_WIDTH = 640;
  const datasets = useMemo(() => timeSeriesDatasets(data, label, series), [data, label, series]);
  const explores = interactive ?? (data.length > 0 && "data" in data[0]);
  const legacyRows = explores ? 6 : 10;
  const ROWS = chartRows(layout, legacyRows, size);
  const visible = datasets.filter(
    (dataset) => !hiddenSeries.includes(dataset.id)
  );
  const points = datasets.flatMap((dataset) => dataset.data);
  const viewport = chartTimeRange(timeRange);
  const allSamples = timeSeriesSamples(datasets);
  const samples = viewport ? allSamples.filter((sample2) => +sample2 >= viewport[0] && +sample2 <= viewport[1]) : allSamples;
  const bars = timeSeriesBars(datasets);
  const domain = (() => {
    const domain2 = viewport ?? timeSeriesDomain(allSamples);
    if (viewport || variant !== "bar") return domain2;
    let low = Infinity, high = -Infinity;
    for (const series2 of bars)
      for (const bar of series2.data) {
        low = Math.min(low, bar.x);
        high = Math.max(high, bar.x1);
      }
    return Number.isFinite(low) ? [low, high] : domain2;
  })();
  const fixedValues = timeSeriesValueDomain(valueDomain, variant !== "line");
  const barDomain = (() => {
    let low = 0, high = 0;
    for (const series2 of bars)
      for (const bar of series2.data) {
        low = Math.min(low, bar.y, bar.y1);
        high = Math.max(high, bar.y, bar.y1);
      }
    return [low, high === low ? low + 1 : high];
  })();
  const index = chartTimeIndex(samples, activeX, (sample2) => +sample2);
  const sample = samples[index];
  const sampleLabel = sample === void 0 ? "No samples" : (formatX ?? formatTimeSample)(sample);
  const readings = visible.map((dataset) => ({
    ...dataset,
    value: dataset.samples.get(+(sample ?? NaN))
  }));
  const announcement = `${sampleLabel}. ${readings.map((reading) => `${reading.label}: ${reading.value === void 0 ? "No sample" : format(reading.value)}`).join(", ")}`;
  function toggle(id) {
    setHiddenSeries(
      hiddenSeries.includes(id) ? hiddenSeries.filter((value) => value !== id) : [...hiddenSeries, id]
    );
  }
  function explorePointer(event) {
    if (!explores || samples.length === 0) return;
    setKeyboard(false);
    const box2 = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (event.clientX - box2.left - padding.left) / Math.max(1, drawingWidth - padding.left - padding.right)
      )
    );
    setActiveX(+samples[nearestTimeIndex(samples, domain[0] + fraction * (domain[1] - domain[0]))]);
  }
  function exploreKey(event) {
    if (!explores || samples.length === 0) return;
    if (event.key === "Escape") {
      setActiveX(null);
      return;
    }
    const next = event.key === "Home" ? 0 : event.key === "End" ? samples.length - 1 : ["ArrowRight", "ArrowUp"].includes(event.key) ? index + 1 : ["ArrowLeft", "ArrowDown"].includes(event.key) ? index - 1 : void 0;
    if (next === void 0) return;
    event.preventDefault();
    setKeyboard(true);
    setActiveX(+samples[Math.max(0, Math.min(samples.length - 1, next))]);
  }
  const drawingWidth = width ?? (box && box.width > 0 ? Math.floor(box.width) : FALLBACK_WIDTH);
  const drawingHeight = Math.max(1, plotBox?.height ? Math.floor(plotBox.height) : typeof height === "number" ? height : Math.round(rhythm.row * ROWS));
  const baseline = variant !== "line" ? 0 : void 0;
  const extremes = (() => {
    let low = baseline ?? Infinity;
    let high = baseline ?? -Infinity;
    for (const point of points) {
      if (!Number.isFinite(point.y)) continue;
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }
    return Number.isFinite(low) ? [low, high] : [];
  })();
  const padding = timeSeriesPadding(samples, domain, (fixedValues ?? (variant === "bar" || variant === "stacked-area" ? barDomain : extremes)).map((value) => format(value)), formatX, rhythm.inset, presentation === "minimal");
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "figure",
    {
      ref: figure,
      "data-ds-chart": true,
      "data-chart-loaded": chart.Engine ? "" : void 0,
      "data-chart-kind": "time-series",
      "data-chart-variant": variant,
      "data-chart-inspecting": chartCursor(activeX, domain) !== void 0 ? "" : void 0,
      "data-chart-presentation": presentation,
      "data-chart-layout": layout,
      "data-chart-readout": readout,
      "data-chart-series": series,
      "data-chart-width": width === void 0 ? "fluid" : "fixed",
      role: explores ? "group" : "img",
      "aria-label": label,
      className: chartFigure({
        series,
        fluid: width === void 0,
        class: `w-full overflow-hidden rounded-lg ${chartSurface({ fill: height === "fill" })} ${className}`
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
        /* @__PURE__ */ jsx(
          "div",
          {
            "data-chart-explorer": true,
            ref: plot,
            style: { height: chartHeightStyle(layout, legacyRows, size, height) },
            role: explores ? "slider" : void 0,
            tabIndex: explores && samples.length > 0 ? 0 : void 0,
            "aria-label": explores ? `Explore ${label}` : void 0,
            "aria-orientation": explores ? "horizontal" : void 0,
            "aria-valuemin": explores ? 0 : void 0,
            "aria-valuemax": explores ? Math.max(0, samples.length - 1) : void 0,
            "aria-valuenow": explores ? index : void 0,
            "aria-valuetext": explores ? announcement : void 0,
            className: `relative min-h-0 shrink-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${height === "fill" ? "flex-1" : chartAdaptiveHeight(layout, legacyRows, size, height)}`,
            onPointerMove: explorePointer,
            onPointerDown: explorePointer,
            onKeyDown: exploreKey,
            onBlur: () => setKeyboard(false),
            children: chart.Engine ? (() => {
              const Engine = chart.Engine;
              return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                Engine,
                {
                  data: points,
                  datasets: visible,
                  variant,
                  curve,
                  presentation,
                  format,
                  formatX,
                  baseline,
                  domain,
                  samples,
                  valueDomain: fixedValues,
                  barDomain,
                  cursor: explores ? chartCursor(activeX, domain) : void 0,
                  width: drawingWidth,
                  height: drawingHeight,
                  padding
                }
              ) });
            })() : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
              "div",
              {
                "data-chart-placeholder": true,
                "aria-hidden": "true",
                className: "h-full w-full"
              }
            ) })
          }
        ),
        explores ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              "data-chart-legend": true,
              "aria-label": `${label} series`,
              className: "flex flex-wrap gap-[var(--reddb-spatial-gap-sm)]",
              children: datasets.map((dataset, index2) => {
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    "aria-pressed": !hiddenSeries.includes(dataset.id),
                    "data-chart-legend-item": dataset.id,
                    className: quietControl({
                      ink: "foreground",
                      class: "inline-flex min-h-[var(--reddb-spatial-control-height-sm)] items-center gap-[var(--reddb-spatial-gap-sm)] rounded-md px-[var(--reddb-spatial-gap-sm)] aria-[pressed=false]:text-ink-muted"
                    }),
                    onClick: () => toggle(dataset.id),
                    children: [
                      /* @__PURE__ */ jsx(
                        "span",
                        {
                          "aria-hidden": "true",
                          className: `size-[var(--reddb-spatial-gap-md)] rounded-full border border-current ${hiddenSeries.includes(dataset.id) ? "bg-transparent" : "bg-current"}`,
                          style: { color: dataset.paint }
                        }
                      ),
                      /* @__PURE__ */ jsx("span", { className: "text-caption", children: dataset.label })
                    ]
                  }
                ) }, dataset.id);
              })
            }
          ),
          /* @__PURE__ */ jsxs(
            "div",
            {
              "data-chart-tooltip": true,
              "aria-live": keyboard ? "polite" : "off",
              className: readout === "hidden" ? "sr-only" : `flex shrink-0 min-h-[var(--reddb-spatial-control-height-md)] flex-wrap items-center gap-x-[var(--reddb-spatial-layout-gap-sm)] gap-y-[var(--reddb-spatial-gap-sm)] text-caption text-ink-muted tabular-nums ${chartReadout(layout, readout)}`,
              children: [
                /* @__PURE__ */ jsx("span", { "data-chart-sample": true, children: sampleLabel }),
                readings.map((reading, index2) => {
                  return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs("span", { "data-chart-reading": reading.id, children: [
                    reading.label,
                    " ",
                    /* @__PURE__ */ jsx("strong", { className: "font-medium text-foreground", children: reading.value === void 0 ? "No sample" : format(reading.value) })
                  ] }) }, reading.id);
                }),
                visible.length === 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("span", { children: "All series hidden. Use the legend to restore them." }) }) : null
              ]
            }
          )
        ] }) : null
      ]
    }
  ) });
}
var TimeSeries_default = TimeSeries;
export {
  TimeSeries,
  TimeSeries_default as default
};
