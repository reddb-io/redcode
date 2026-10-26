import { domain, finite, unique } from "./visualization.js";
function scatterData(data) {
  unique(data, "Scatter");
  for (const p of data) {
    finite(p.x, p.id);
    finite(p.y, p.id);
    if (p.radius !== void 0 && (!Number.isFinite(p.radius) || p.radius < 0)) throw new Error("Point radius must be non-negative");
  }
  return data;
}
function regression(data) {
  if (data.length < 2) return void 0;
  const n = data.length, x = data.reduce((s, p) => s + p.x, 0) / n, y = data.reduce((s, p) => s + p.y, 0) / n;
  const xx = data.reduce((s, p) => s + (p.x - x) ** 2, 0);
  if (!xx) return void 0;
  const slope = data.reduce((s, p) => s + (p.x - x) * (p.y - y), 0) / xx;
  const range = domain(data.map((p) => p.x));
  return range.map((v) => ({ x: v, y: y + slope * (v - x) }));
}
export {
  regression,
  scatterData
};
