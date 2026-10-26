import { arc } from "d3-shape";
import { ringThickness } from "@reddb-io/design-system/base/recipes";
import { automaticChartPalette, chartColor } from "./chart-color.js";
import { unique, finite } from "../visualization.js";
function circularModel(data, thickness, selected, palette) {
  unique(data, "PieChart");
  if (thickness !== void 0) ringThickness(thickness);
  let total = 0;
  for (const item of data) {
    finite(item.value, item.id);
    if (item.value < 0) throw new Error("PieChart: contributions must be nonnegative");
    total += item.value;
  }
  finite(total, "PieChart total");
  let angle = 0;
  const shape = arc().outerRadius(100).innerRadius(thickness === void 0 ? 0 : 100 * (1 - thickness));
  const automatic = automaticChartPalette(data);
  const slices = data.map((item, index) => {
    const fraction = total ? item.value / total : 0, startAngle = angle;
    angle += fraction * Math.PI * 2;
    const geometry = { startAngle, endAngle: angle, innerRadius: 0, outerRadius: 100 };
    return { ...item, fraction, paint: chartColor(item, palette, automatic), path: fraction ? shape(geometry) ?? "" : "", centroid: shape.centroid(geometry) };
  });
  const active = data.find((item) => item.id === selected);
  const reading = { total, selected: active, value: active?.value ?? total, percent: total ? (active ? active.value / total : 1) * 100 : 0 };
  return { slices, reading };
}
function circularFocus(event) {
  const target = event.target;
  const root = target?.closest("[data-circular-plot]");
  if (!root || !target) return;
  const marks = [...root.querySelectorAll('[data-mark-id][role="button"]')];
  const current = marks.findIndex((mark) => mark.contains(target));
  if (current < 0 || !marks.length) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? marks.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (current + 1) % marks.length : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (current - 1 + marks.length) % marks.length : void 0;
  if (next !== void 0) {
    event.preventDefault();
    marks[next]?.focus();
  }
}
export {
  circularFocus,
  circularModel
};
