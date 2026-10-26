import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { formatChartNumber } from "../../src/chart.js";
import { useId, useMemo } from "react";
import { compositeGeometry, compositeColumnLabel } from "../../src/core/composite-geometry.js";
function CompositeChartPlot({ model, layout, hiddenSeries, cursor, presentation }) {
  const geometry = useMemo(() => compositeGeometry(model, layout, hiddenSeries), [model, layout, hiddenSeries]), clipId = `${useId()}-plot`;
  const cursorPosition = cursor === void 0 ? void 0 : geometry.cursor(cursor);
  return /* @__PURE__ */ jsxs("svg", { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsx("clipPath", { id: clipId, children: /* @__PURE__ */ jsx("rect", { width: layout.plotWidth, height: layout.plotHeight }) }) }),
    /* @__PURE__ */ jsxs("g", { transform: `translate(${layout.padding.left} ${layout.padding.top})`, children: [
      presentation === "full" && /* @__PURE__ */ jsx("g", { "data-chart-grid": true, stroke: "var(--reddb-color-muted)", children: layout.primaryTicks.map((tick) => /* @__PURE__ */ jsx("line", { x1: layout.horizontal ? tick.position : 0, x2: layout.horizontal ? tick.position : layout.plotWidth, y1: layout.horizontal ? 0 : tick.position, y2: layout.horizontal ? layout.plotHeight : tick.position }, tick.value)) }),
      /* @__PURE__ */ jsxs("g", { clipPath: `url(#${clipId})`, children: [
        geometry.layers.map((layer) => /* @__PURE__ */ jsxs("g", { "data-composite-layer": layer.id, "data-composite-kind": layer.kind, "data-composite-axis": layer.axis, children: [
          layer.fill && /* @__PURE__ */ jsx("path", { d: layer.fill, fill: layer.paint, fillOpacity: 0.2 }),
          layer.rects.map((rect, index) => /* @__PURE__ */ jsx("rect", { ...rect, fill: rect.paint ?? layer.paint, "data-composite-column": true }, index)),
          model.options?.dataLabels === "value" && layer.rects.map((rect, index) => {
            const reading = compositeColumnLabel(rect, layout, model.options.columnMode === "stacked", layer.format ?? formatChartNumber);
            return reading.visible ? /* @__PURE__ */ jsx("text", { "data-column-label": true, x: reading.x, y: reading.y, textAnchor: "middle", dominantBaseline: "middle", fill: "var(--reddb-color-foreground)", stroke: "var(--reddb-color-background)", strokeWidth: 3, paintOrder: "stroke", className: "text-xs", children: reading.text }, index) : null;
          }),
          layer.candles.map((candle) => /* @__PURE__ */ jsxs("g", { "data-candle": candle.direction, strokeWidth: model.options?.strokeWidth ?? 1, children: [
            /* @__PURE__ */ jsx("line", { x1: candle.center, x2: candle.center, y1: candle.high, y2: candle.low, stroke: layer.paint }),
            candle.direction === "flat" ? /* @__PURE__ */ jsx("line", { x1: candle.x, x2: candle.x + candle.width, y1: candle.y, y2: candle.y, stroke: layer.paint }) : /* @__PURE__ */ jsx("rect", { x: candle.x, y: candle.y, width: candle.width, height: candle.height, stroke: layer.paint, fill: candle.direction === "up" ? "var(--reddb-color-background)" : layer.paint })
          ] }, candle.key)),
          layer.path && /* @__PURE__ */ jsx("path", { d: layer.path, fill: "none", stroke: layer.paint, strokeWidth: model.options?.strokeWidth ?? 1.5, strokeDasharray: layer.dash })
        ] }, layer.id)),
        geometry.references.map((reference) => /* @__PURE__ */ jsx("line", { "data-composite-reference": reference.id, x1: reference.x1, x2: reference.x2, y1: reference.y1, y2: reference.y2, stroke: reference.paint, strokeDasharray: "4 3", children: /* @__PURE__ */ jsx("title", { children: reference.label }) }, reference.id)),
        cursorPosition !== void 0 && /* @__PURE__ */ jsx("line", { "data-chart-cursor": true, x1: layout.horizontal ? 0 : cursorPosition, x2: layout.horizontal ? layout.plotWidth : cursorPosition, y1: layout.horizontal ? cursorPosition : 0, y2: layout.horizontal ? cursorPosition : layout.plotHeight, stroke: "var(--reddb-color-ink-muted)", strokeDasharray: "3 3" })
      ] }),
      model.options?.showTotals && geometry.totals.filter((total) => layout.horizontal || layout.plotWidth * model.interval / (model.sampleDomain[1] - model.sampleDomain[0]) > (total.format ?? formatChartNumber)(total.value).length * 7 + 4).map((total) => /* @__PURE__ */ jsx("text", { "data-stack-total": true, stroke: "var(--reddb-color-background)", strokeWidth: 3, paintOrder: "stroke", x: total.x, y: Math.min(layout.plotHeight - 8, Math.max(-14, total.y + (total.value >= 0 ? -6 : 14))), textAnchor: "middle", fill: "var(--reddb-color-foreground)", className: "text-xs", children: (total.format ?? formatChartNumber)(total.value) }, `${total.axis}:${total.key}:${total.value >= 0}`)),
      presentation === "full" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("g", { "data-composite-axis": "sample", fill: "var(--reddb-color-ink-muted)", className: "text-xs font-regular", children: layout.sampleTicks.map((tick) => /* @__PURE__ */ jsx("text", { x: layout.horizontal ? -6 : tick.position, y: layout.horizontal ? tick.position : layout.plotHeight + 17, transform: !layout.horizontal && model.options?.categoryLabelAngle ? `rotate(${model.options.categoryLabelAngle},${tick.position},${layout.plotHeight + 17})` : void 0, textAnchor: layout.horizontal || model.options?.categoryLabelAngle ? "end" : "middle", dominantBaseline: layout.horizontal ? "middle" : "auto", children: tick.label }, tick.value)) }),
        /* @__PURE__ */ jsx("g", { "data-composite-axis": "primary", fill: "var(--reddb-color-ink-muted)", className: "text-xs font-regular", children: layout.primaryTicks.map((tick) => /* @__PURE__ */ jsx("text", { x: layout.horizontal ? tick.position : -6, y: layout.horizontal ? layout.plotHeight + 17 : tick.position, textAnchor: layout.horizontal ? "middle" : "end", dominantBaseline: layout.horizontal ? "auto" : "middle", children: tick.label }, tick.value)) }),
        /* @__PURE__ */ jsx("g", { "data-composite-axis": "secondary", fill: "var(--reddb-color-ink-muted)", className: "text-xs font-regular", children: layout.secondaryTicks.map((tick) => /* @__PURE__ */ jsx("text", { x: layout.horizontal ? tick.position : layout.plotWidth + 6, y: layout.horizontal ? -8 : tick.position, textAnchor: layout.horizontal ? "middle" : "start", dominantBaseline: layout.horizontal ? "auto" : "middle", children: tick.label }, tick.value)) })
      ] })
    ] })
  ] });
}
export {
  CompositeChartPlot as default
};
