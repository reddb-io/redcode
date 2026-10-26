import { scatterData, regression } from "../scatter.js";
import { domain } from "../visualization.js";
import { automaticChartColors, chartColor } from "./chart-color.js";
function scaleProject(value, range, start, end, scale = "linear") {
  const transform = (n) => scale === "log" ? Math.log10(n) : n;
  return start + (transform(value) - transform(range[0])) / (transform(range[1]) - transform(range[0])) * (end - start);
}
function scaleTicks(range, scale = "linear", count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => scale === "log" ? 10 ** (Math.log10(range[0]) + i / count * Math.log10(range[1] / range[0])) : range[0] + i / count * (range[1] - range[0]));
}
function paretoFrontier(data, directions) {
  const sx = directions.x === "minimize" ? 1 : -1, sy = directions.y === "minimize" ? 1 : -1;
  const sorted = [...data].sort((a, b) => sx * (a.x - b.x) || sy * (a.y - b.y));
  let best = Infinity;
  return sorted.filter((point) => {
    const y = sy * point.y;
    if (y >= best) return false;
    best = y;
    return true;
  }).sort((a, b) => a.x - b.x);
}
function scatterAnalysis(data, options, xDomain, yDomain, trend = false) {
  const points = automaticChartColors(scatterData(data).map((point) => ({ ...point, color: point.color ?? options.palette?.[point.id] }))), xd = domain(points.map((p) => p.x), xDomain), yd = domain(points.map((p) => p.y), yDomain);
  for (const axis of ["x", "y"]) {
    const range = axis === "x" ? xd : yd;
    if (options[`${axis}Scale`] === "log" && (range[0] <= 0 || points.some((p) => p[axis] <= 0))) throw new Error(`Logarithmic ${axis} scale requires positive observations and domain`);
  }
  if (options.strokeWidth !== void 0 && (!Number.isFinite(options.strokeWidth) || options.strokeWidth <= 0)) throw new Error("strokeWidth must be positive");
  const ids = /* @__PURE__ */ new Set();
  const highlights = (options.highlights ?? []).flatMap((region) => {
    if (!region.id || ids.has(region.id) || [...region.x, ...region.y].some((v) => !Number.isFinite(v)) || region.x[0] >= region.x[1] || region.y[0] >= region.y[1]) throw new Error("Invalid or duplicate scatter highlight");
    ids.add(region.id);
    const x = [Math.max(xd[0], region.x[0]), Math.min(xd[1], region.x[1])], y = [Math.max(yd[0], region.y[0]), Math.min(yd[1], region.y[1])];
    return x[0] < x[1] && y[0] < y[1] ? [{ ...region, x, y }] : [];
  });
  const fit = trend ? regression(points) : void 0;
  const line = fit && (options.xScale === "log" || options.yScale === "log") ? Array.from({ length: 65 }, (_, index) => {
    const a = fit[0], b = fit[1], x = a.x + (b.x - a.x) * index / 64;
    return { x, y: a.y + (b.y - a.y) * index / 64 };
  }) : fit;
  return { points, xd, yd, frontier: options.pareto ? paretoFrontier(points, options.pareto) : [], line, highlights };
}
function scatterDrawing(model, options, width, height, formatX, formatY) {
  const left = Math.min(width * 0.25, Math.max(44, ...scaleTicks(model.yd, options.yScale).map((v) => formatY(v).length * 7 + 12))), right = width - 20, top = 28, bottom = height - 44;
  const px = (value) => scaleProject(value, model.xd, left, right, options.xScale), py = (value) => scaleProject(value, model.yd, bottom, top, options.yScale);
  const boxes = [];
  const points = model.points.map((point) => {
    const x = px(point.x), y = py(point.y), text = point.label.length > 30 ? point.label.slice(0, 29) + "\u2026" : point.label, w = Math.min(text.length * 6.5, right - left);
    let label;
    if (options.pointLabels && x >= left && x <= right && y >= top && y <= bottom) for (const [dx, dy, anchor] of [[9, -8, "start"], [9, 14, "start"], [-9, -8, "end"], [-9, 14, "end"]]) {
      const box = { x: x + dx - (anchor === "end" ? w : 0), y: y + dy - 11, w, h: 14 };
      if (box.x < left || box.x + w > right || box.y < top || box.y + box.h > bottom || boxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
      boxes.push(box);
      label = { x: x + dx, y: y + dy, anchor, text };
      break;
    }
    return { ...point, x, y, paint: chartColor(point, options.palette), caption: label };
  });
  return {
    left,
    right,
    top,
    bottom,
    points,
    path: (points2) => points2.reduce((result, p) => {
      const x = px(p.x), y = py(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        result.open = false;
        return result;
      }
      result.parts.push(`${result.open ? "L" : "M"}${x},${y}`);
      result.open = true;
      return result;
    }, { parts: [], open: false }).parts.join(" "),
    xTicks: scaleTicks(model.xd, options.xScale).map((value) => ({ value, position: px(value), label: formatX(value) })),
    yTicks: scaleTicks(model.yd, options.yScale).map((value) => ({ value, position: py(value), label: formatY(value) })),
    regions: model.highlights.map((r) => ({ ...r, x: px(r.x[0]), y: py(r.y[1]), width: px(r.x[1]) - px(r.x[0]), height: py(r.y[0]) - py(r.y[1]) }))
  };
}
export {
  paretoFrontier,
  scaleProject,
  scaleTicks,
  scatterAnalysis,
  scatterDrawing
};
