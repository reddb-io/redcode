"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useControllableValue } from "@reddb-io/design-system/base";
import { tokenColor } from "@reddb-io/design-system/base/recipes";
import { scatterAnalysis, scatterDrawing } from "../../src/core/scatter-analysis.js";
import { edge, ink, mutedInk, number } from "../../src/visualization.js";
import Frame from "./VisualizationFrame.js";
import Canvas from "./ChartCanvas.js";
import Mark from "./VisualizationMark.js";
function Scatter(props) {
  const { selected: initialSelected = "", data, xDomain, yDomain, trend = false, formatX = number, formatY = number, xScale = "linear", yScale = "linear", pareto, pointLabels = false, highlights = [], palette, strokeWidth = 1.5, xLabel = "", yLabel = "", label = "Scatter", description, width, height, size = "lg", interactive = true, detailHref, className = "" } = props;
  const [selected, select] = useControllableValue(props.selected, initialSelected, props.onSelectedChange);
  const options = { xScale, yScale, pareto, pointLabels, highlights, palette, strokeWidth }, model = scatterAnalysis(data, options, xDomain, yDomain, trend);
  const rows = model.points.map((p) => ({ ...p, value: `${formatX(p.x)} / ${formatY(p.y)}` }));
  return /* @__PURE__ */ jsx(Frame, { kind: "Scatter", label, description, width, height, size, selected, detailHref, rows, onSelect: interactive ? select : void 0, className, children: ({ width: w, height: h }) => {
    const drawing = scatterDrawing(model, options, w, h, formatX, formatY);
    return /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
      drawing.regions.map((region) => /* @__PURE__ */ jsx("rect", { "data-scatter-region": region.id, x: region.x, y: region.y, width: region.width, height: region.height, fill: tokenColor(region.color, edge), children: /* @__PURE__ */ jsx("title", { children: region.label }) }, region.id)),
      drawing.yTicks.map((tick) => /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("line", { x1: drawing.left, x2: drawing.right, y1: tick.position, y2: tick.position, stroke: edge }),
        /* @__PURE__ */ jsx("text", { x: drawing.left - 8, y: tick.position, textAnchor: "end", dominantBaseline: "middle", fill: mutedInk, className: "text-xs", children: tick.label })
      ] }, tick.value)),
      drawing.xTicks.map((tick) => /* @__PURE__ */ jsx("text", { x: tick.position, y: h - 24, textAnchor: "middle", fill: mutedInk, className: "text-xs", children: tick.label }, tick.value)),
      /* @__PURE__ */ jsx("text", { x: drawing.left, y: 16, fill: mutedInk, className: "text-xs", children: yLabel }),
      /* @__PURE__ */ jsx("text", { x: drawing.right, y: h - 5, textAnchor: "end", fill: mutedInk, className: "text-xs", children: xLabel }),
      model.line && /* @__PURE__ */ jsx("path", { "data-regression": true, d: drawing.path(model.line), fill: "none", stroke: mutedInk, strokeWidth, strokeDasharray: "5 5" }),
      model.frontier.length > 0 && /* @__PURE__ */ jsx("path", { "data-pareto": true, d: drawing.path(model.frontier), fill: "none", stroke: ink, strokeWidth, strokeDasharray: "2 4", children: /* @__PURE__ */ jsx("title", { children: "Pareto frontier" }) }),
      drawing.points.map((p) => /* @__PURE__ */ jsxs(Mark, { id: p.id, label: `${p.label}: ${formatX(data.find((item) => item.id === p.id).x)}, ${formatY(data.find((item) => item.id === p.id).y)}`, selected, onSelect: interactive ? select : void 0, children: [
        /* @__PURE__ */ jsx("circle", { cx: p.x, cy: p.y, r: p.radius ?? 5, fill: p.paint, stroke: selected === p.id ? ink : p.paint, strokeWidth: selected === p.id ? 3 : strokeWidth }),
        p.caption && /* @__PURE__ */ jsx("text", { "data-point-label": p.id, x: p.caption.x, y: p.caption.y, textAnchor: p.caption.anchor, fill: ink, className: "text-xs", children: p.caption.text })
      ] }, p.id))
    ] });
  } });
}
var Scatter_default = Scatter;
export {
  Scatter,
  Scatter_default as default
};
