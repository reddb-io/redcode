import { jsx, jsxs } from "react/jsx-runtime";
import { scaleBand, scaleLinear } from "d3-scale";
import { formatChartNumber } from "../../src/chart.js";
function HistogramPlot({
  data,
  width,
  height,
  padding,
  bandPadding,
  countTicks,
  binTicks
}) {
  const w = Math.max(1, width - padding.left - padding.right), h = Math.max(1, height - padding.top - padding.bottom), largest = data.reduce((max, bin) => Math.max(max, bin.count), 0), x = scaleBand().domain(data.map((bin) => bin.x0)).range([0, w]).padding(bandPadding), y = scaleLinear().domain([0, largest || 1]).range([h, 0]).nice(), ticks = countTicks(y), every = Math.max(1, Math.ceil(data.length / Math.max(1, binTicks)));
  return /* @__PURE__ */ jsx(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsxs("g", { transform: `translate(${padding.left} ${padding.top})`, children: [
        ticks.map((tick) => /* @__PURE__ */ jsxs("g", { children: [
          /* @__PURE__ */ jsx(
            "line",
            {
              x1: 0,
              x2: w,
              y1: y(tick),
              y2: y(tick),
              stroke: "var(--reddb-color-muted)"
            }
          ),
          /* @__PURE__ */ jsx(
            "text",
            {
              x: -6,
              y: y(tick),
              dy: "0.32em",
              textAnchor: "end",
              fill: "var(--reddb-color-ink-muted)",
              "data-chart-axis-label": true,
              className: "text-xs font-regular text-ink-muted",
              children: formatChartNumber(tick, 0)
            }
          )
        ] }, tick)),
        data.map((bin, index) => /* @__PURE__ */ jsxs("g", { children: [
          /* @__PURE__ */ jsx(
            "rect",
            {
              "data-histogram-bin": true,
              x: x(bin.x0),
              y: y(bin.count),
              width: x.bandwidth(),
              height: h - y(bin.count),
              fill: "var(--color-primary)"
            }
          ),
          index % every === 0 && /* @__PURE__ */ jsx(
            "text",
            {
              x: x(bin.x0) + x.bandwidth() / 2,
              y: h + 18,
              textAnchor: "middle",
              fill: "var(--reddb-color-ink-muted)",
              "data-chart-axis-label": true,
              className: "text-xs font-regular text-ink-muted",
              children: bin.label
            }
          )
        ] }, bin.x0))
      ] })
    }
  );
}
export {
  HistogramPlot as default
};
