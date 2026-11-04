const ALL_METRICS = "__all__";
const CHART_WIDTH = 640, CHART_HEIGHT = 180, CHART_PADDING = 16;
function normalizeEventPoints(points) {
  return points.filter(
    (point) => Number.isFinite(point.t) && Math.abs(point.t) <= 864e13 && Number.isFinite(point.v)
  ).slice().sort((a, b) => a.t - b.t);
}
function effectiveBucketMs(points, requested) {
  const size = Number.isFinite(requested) && requested >= 1 ? requested : 6e4;
  const ordered = normalizeEventPoints(points);
  const first = ordered[0]?.t ?? 0, last = ordered.at(-1)?.t ?? first;
  return Math.max(size, Math.ceil((last - first) / size / 2047) * size);
}
function chartGeometry(series, width = CHART_WIDTH, height = CHART_HEIGHT, padding = CHART_PADDING) {
  const pts = series.points;
  if (pts.length === 0) return null;
  const minT = pts[0].t;
  const maxT = pts[pts.length - 1].t;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
  const spanT = maxT - minT || 1;
  const spanV = maxV - minV || 1;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const segments = [];
  pts.forEach((p, i) => {
    const x = padding + (p.t - minT) / spanT * w;
    const y = padding + h - (p.v - minV) / spanV * h;
    segments.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  });
  return {
    width,
    height,
    padding,
    path: segments.join(" "),
    minT,
    maxT,
    minV,
    maxV
  };
}
function bucketSeries(series, bucketMs = 6e4) {
  series = { ...series, points: normalizeEventPoints(series.points) };
  bucketMs = effectiveBucketMs(series.points, bucketMs);
  if (series.points.length === 0) return [];
  const firstT = series.points[0].t;
  const lastT = series.points[series.points.length - 1].t;
  const start = Math.floor(firstT / bucketMs) * bucketMs;
  const end = Math.floor(lastT / bucketMs) * bucketMs;
  const buckets = /* @__PURE__ */ new Map();
  for (let t = start; t <= end; t += bucketMs) {
    buckets.set(t, { t, count: 0, sum: 0 });
  }
  for (const p of series.points) {
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    const b = buckets.get(key);
    if (!b) continue;
    b.count += 1;
    b.sum += p.v;
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
function bucketGeometry(buckets, width = CHART_WIDTH, height = CHART_HEIGHT, padding = CHART_PADDING) {
  if (buckets.length === 0) return null;
  const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  if (maxCount === 0) return null;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const slot = w / buckets.length;
  const barWidth = Math.max(1, slot - 1);
  const bars = buckets.map((bucket, i) => {
    const ratio = bucket.count / maxCount;
    const barH = ratio * h;
    return {
      x: padding + i * slot,
      y: padding + h - barH,
      w: barWidth,
      h: barH,
      bucket
    };
  });
  return { width, height, padding, bars, maxCount };
}
function formatEventTime(t) {
  const date = new Date(t);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").slice(0, 19) : String(t);
}
function eventPayload(raw) {
  const parts = [];
  if (raw.metric !== void 0) parts.push(String(raw.metric));
  if (raw.tags && typeof raw.tags === "object")
    parts.push(
      Object.entries(raw.tags).map(
        ([key, value2]) => `${key}=${typeof value2 === "object" ? JSON.stringify(value2) : String(value2)}`
      ).join(" ")
    );
  const value = raw.event ?? raw.action ?? raw.message ?? raw.payload;
  if (value !== void 0)
    parts.push(
      typeof value === "object" ? JSON.stringify(value) : String(value)
    );
  return parts.filter(Boolean).join(" \xB7 ");
}
const bucketOptions = [1e3, 1e4, 6e4, 3e5, 6e5, 36e5];
function bucketLabel(ms) {
  return ms < 6e4 ? `${ms / 1e3}s` : ms < 36e5 ? `${ms / 6e4}min` : `${ms / 36e5}hr`;
}
function seriesBuckets(points, ms) {
  return bucketSeries(
    {
      points: [...points],
      timeColumn: "",
      metricColumn: "",
      metrics: [],
      metricNameColumn: null
    },
    ms
  );
}
function renderEventSeriesSnapshot(series) {
  if (!series)
    return '<section class="hypertable empty">No timeseries shape detected.</section>';
  const geom = chartGeometry(series);
  const lines = [];
  lines.push('<section class="hypertable">');
  lines.push(
    `<header class="summary">${series.points.length} pts \xB7 metric <code>${escapeHtml(series.metricColumn)}</code></header>`
  );
  if (geom) {
    lines.push(
      `<svg viewBox="0 0 ${geom.width} ${geom.height}" class="chart"><path d="${geom.path}" /></svg>`
    );
  }
  lines.push("</section>");
  return lines.join("");
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export {
  ALL_METRICS,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  bucketGeometry,
  bucketLabel,
  bucketOptions,
  bucketSeries,
  chartGeometry,
  effectiveBucketMs,
  eventPayload,
  formatEventTime,
  normalizeEventPoints,
  renderEventSeriesSnapshot,
  seriesBuckets
};
