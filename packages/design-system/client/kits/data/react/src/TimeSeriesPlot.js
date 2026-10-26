import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { chartWindowPoints } from "../../src/core/chart-time.js";
import { timeSeriesSamples } from "../../src/time-series.js";
import { useId } from "react";
import { area, line, curveLinear, curveMonotoneX } from "d3-shape";
import { scaleLinear } from "d3-scale";
import {
  timeSeriesAreas,
  timeSeriesBars,
  timeSeriesDateTicks,
  formatTimeTick
} from "../../src/time-series.js";
function TimeSeriesPlot({
  data,
  datasets,
  domain,
  samples,
  valueDomain,
  cursor,
  formatX,
  variant,
  curve,
  presentation,
  barDomain,
  format,
  baseline,
  width,
  height,
  padding
}) {
  const id = useId().replaceAll(":", ""), w = Math.max(1, width - padding.left - padding.right), h = Math.max(1, height - padding.top - padding.bottom), x = scaleLinear().domain(domain).range([0, w]);
  let low = baseline ?? Infinity, high = baseline ?? -Infinity;
  for (const point of data) {
    if (!Number.isFinite(point.y)) continue;
    low = Math.min(low, point.y);
    high = Math.max(high, point.y);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    low = 0;
    high = 1;
  }
  const bounds = valueDomain ?? (variant === "bar" || variant === "stacked-area" ? barDomain : [low, high]), y = scaleLinear().domain(bounds).range([h, 0]);
  if (valueDomain === void 0) y.nice();
  const plotDatasets = datasets.map((dataset) => ({ ...dataset, data: chartWindowPoints(dataset.data, domain, (point) => +point.x) })), plotSamples = timeSeriesSamples(plotDatasets);
  const interpolation = curve === "smooth" ? curveMonotoneX : curveLinear, bars = timeSeriesBars(plotDatasets, plotSamples), areas = timeSeriesAreas(plotDatasets, plotSamples), dateTicks = timeSeriesDateTicks(samples, w / Math.max(padding.left, 1));
  const yTicks = y.ticks(Math.max(2, Math.floor(h / 50))), xTicks = dateTicks ?? x.ticks(Math.max(2, Math.floor(w / 80))), dateAxis = samples.some((sample) => sample instanceof Date);
  const tickLabel = (value) => formatX ? formatX(dateAxis ? new Date(value) : value) : dateTicks ? formatTimeTick(value, dateTicks) : String(Number(value.toPrecision(6)));
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsx("clipPath", { id, children: /* @__PURE__ */ jsx("rect", { width: w, height: h }) }) }),
        /* @__PURE__ */ jsxs("g", { transform: `translate(${padding.left} ${padding.top})`, children: [
          presentation === "full" && yTicks.map((tick) => /* @__PURE__ */ jsx(
            "line",
            {
              x1: 0,
              x2: w,
              y1: y(tick),
              y2: y(tick),
              stroke: "var(--reddb-color-muted)"
            },
            tick
          )),
          /* @__PURE__ */ jsxs("g", { clipPath: `url(#${id})`, children: [
            plotDatasets.map((dataset) => {
              const path = line().defined((point) => Number.isFinite(point.y)).x((point) => x(+point.x)).y((point) => y(point.y)).curve(interpolation)(dataset.data);
              const fill = variant === "area" ? area().defined((point) => Number.isFinite(point.y)).x((point) => x(+point.x)).y0(y(0)).y1((point) => y(point.y)).curve(interpolation)(dataset.data) : null;
              const band = areas.find((series) => series.id === dataset.id)?.data ?? [];
              const stackedFill = variant === "stacked-area" ? area().defined((point) => point.defined).x((point) => x(point.x)).y0((point) => y(point.y)).y1((point) => y(point.y1)).curve(interpolation)(band) : null;
              const stackedLine = variant === "stacked-area" ? line().defined((point) => point.defined).x((point) => x(point.x)).y((point) => y(point.y1)).curve(interpolation)(band) : null;
              return /* @__PURE__ */ jsx("g", { "data-chart-line": dataset.id, children: variant === "bar" ? (bars.find((series) => series.id === dataset.id)?.data ?? []).map((bar, index) => /* @__PURE__ */ jsx(
                "rect",
                {
                  "data-chart-column": true,
                  x: x(bar.x),
                  y: Math.min(y(bar.y), y(bar.y1)),
                  width: Math.max(0, x(bar.x1) - x(bar.x)),
                  height: Math.abs(y(bar.y1) - y(bar.y)),
                  fill: dataset.paint
                },
                index
              )) : variant === "stacked-area" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                stackedFill && /* @__PURE__ */ jsx(
                  "path",
                  {
                    "data-chart-area": dataset.id,
                    d: stackedFill,
                    fill: dataset.paint,
                    fillOpacity: 0.7
                  }
                ),
                stackedLine && /* @__PURE__ */ jsx(
                  "path",
                  {
                    d: stackedLine,
                    fill: "none",
                    stroke: dataset.paint,
                    strokeWidth: 2
                  }
                )
              ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                fill && /* @__PURE__ */ jsx("path", { d: fill, fill: dataset.paint, fillOpacity: 0.3 }),
                path && /* @__PURE__ */ jsx(
                  "path",
                  {
                    d: path,
                    fill: "none",
                    stroke: dataset.paint,
                    strokeWidth: 2
                  }
                )
              ] }) }, dataset.id);
            }),
            cursor !== void 0 && /* @__PURE__ */ jsx(
              "line",
              {
                "data-chart-cursor": true,
                x1: x(+cursor),
                x2: x(+cursor),
                y1: 0,
                y2: h,
                stroke: "var(--reddb-color-ink-muted)",
                strokeDasharray: "3 3"
              }
            )
          ] }),
          presentation === "full" && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("g", { children: yTicks.map((tick) => /* @__PURE__ */ jsx(
              "text",
              {
                x: -6,
                y: y(tick),
                dy: "0.32em",
                textAnchor: "end",
                fill: "var(--reddb-color-ink-muted)",
                "data-chart-axis-label": true,
                className: "text-xs font-regular text-ink-muted",
                children: format(tick)
              },
              tick
            )) }),
            /* @__PURE__ */ jsx("g", { children: xTicks.map((tick) => /* @__PURE__ */ jsx(
              "text",
              {
                x: x(tick),
                y: h + 18,
                textAnchor: "middle",
                fill: "var(--reddb-color-ink-muted)",
                "data-chart-axis-label": true,
                className: "text-xs font-regular text-ink-muted",
                children: tickLabel(tick)
              },
              tick
            )) })
          ] })
        ] })
      ]
    }
  );
}
export {
  TimeSeriesPlot as default
};
