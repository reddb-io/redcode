import { automaticChartColors } from "./core/chart-color.js";
import { finite, unique } from "./visualization.js";
function radarData(axes, data) {
  unique(axes, "Radar axes");
  unique(data, "Radar series");
  if (axes.length < 3) throw new Error("Radar requires at least three axes");
  for (const axis of axes) {
    const low = axis.min ?? 0, high = axis.max ?? 100;
    finite(low, axis.id);
    finite(high, axis.id);
    if (low >= high) throw new Error("Radar axis bounds must increase");
    for (const s of data) {
      const v = s.values[axis.id];
      if (v != null && (finite(v, axis.id) < low || v > high)) throw new Error(`Radar value outside ${axis.id} domain`);
    }
  }
  return automaticChartColors(data);
}
function radarPoint(index, count, fraction, cx, cy, radius) {
  const angle = index / count * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * radius * fraction, y: cy + Math.sin(angle) * radius * fraction };
}
function radarFraction(value, axis) {
  const f = (value - (axis.min ?? 0)) / ((axis.max ?? 100) - (axis.min ?? 0));
  return axis.higherIsBetter === false ? 1 - f : f;
}
export {
  radarData,
  radarFraction,
  radarPoint
};
