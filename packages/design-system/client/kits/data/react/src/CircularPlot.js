import { jsx, jsxs } from "react/jsx-runtime";
import { useRef, useState, useEffect } from "react";
import { RadialContent } from "@reddb-io/design-system/base";
import { circularFocus, circularModel } from "../../src/core/circular-chart.js";
import Mark from "./VisualizationMark.js";
function CircularPlot({ data, label, thickness, selected, palette, labels, format, height, center, onSelect }) {
  const ref = useRef(null), [box, setBox] = useState({ width: 640, height: 320 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) setBox(entry.contentRect);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { width, height: h } = box, diameter = Math.max(1, Math.min(width, h) - 16), centerSize = diameter * (1 - (thickness ?? 1)) * 0.9;
  const model = circularModel(data, thickness, selected, palette);
  return /* @__PURE__ */ jsxs("div", { ref, role: "group", "aria-label": `${label} slices`, onKeyDown: (event) => circularFocus(event.nativeEvent), "data-circular-plot": true, className: "relative grid min-h-0 min-w-0 flex-1 place-items-center", style: { height }, children: [
    /* @__PURE__ */ jsx("svg", { width, height: h, viewBox: `0 0 ${width} ${h}`, role: "group", "aria-label": label, children: model.slices.filter((slice) => slice.path).map((slice) => /* @__PURE__ */ jsxs("g", { children: [
      /* @__PURE__ */ jsx(Mark, { id: slice.id, label: `${slice.label}: ${format(slice.value)} (${(slice.fraction * 100).toFixed(1)}%)`, selected: selected ?? "", onSelect, children: /* @__PURE__ */ jsx("path", { "data-slice": slice.id, d: slice.path, transform: `translate(${width / 2} ${h / 2}) scale(${diameter / 200})`, fill: slice.paint, stroke: selected === slice.id ? "var(--reddb-color-foreground)" : "var(--reddb-color-background)", strokeWidth: selected === slice.id ? 2 : 1 }) }),
      labels !== "none" && slice.fraction >= 0.08 && diameter >= 160 && /* @__PURE__ */ jsx("text", { x: width / 2 + slice.centroid[0] * diameter / 200, y: h / 2 + slice.centroid[1] * diameter / 200, textAnchor: "middle", dominantBaseline: "middle", fill: "var(--reddb-color-foreground)", stroke: "var(--reddb-color-background)", strokeWidth: 3, paintOrder: "stroke", className: "pointer-events-none text-caption", children: labels === "percent" ? `${(slice.fraction * 100).toFixed(0)}%` : format(slice.value) })
    ] }, slice.id)) }),
    thickness !== void 0 && /* @__PURE__ */ jsx("div", { "data-donut-center": true, className: "pointer-events-none absolute grid place-items-center overflow-hidden", style: { width: centerSize, height: centerSize }, children: center ? center(model.reading) : /* @__PURE__ */ jsx(RadialContent, { title: model.reading.total ? model.reading.selected?.label ?? "Total" : "No contributions", value: format(model.reading.value) }) }),
    !model.reading.total && thickness === void 0 && /* @__PURE__ */ jsx("span", { "data-circular-empty": true, className: "absolute text-caption text-ink-muted", children: "No contributions" })
  ] });
}
export {
  CircularPlot as default
};
