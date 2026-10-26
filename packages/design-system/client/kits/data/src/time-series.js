import { axisLabelWidth, valueAxisGutter, CATEGORY_AXIS_GUTTER_PX } from "./chart.js";
function timeSeriesDatasets(data, label, series) {
  const multiple = data.length > 0 && "data" in data[0];
  const datasets = multiple ? data : [{ id: "series", label, data, series }];
  const ids = /* @__PURE__ */ new Set();
  return datasets.map((dataset, index) => {
    if (ids.has(dataset.id)) throw new Error(`TimeSeries: duplicate dataset id "${dataset.id}"`);
    ids.add(dataset.id);
    const role = dataset.series ?? index % 6 + 1;
    return {
      ...dataset,
      samples: new Map(dataset.data.filter((point) => Number.isFinite(+point.x) && Number.isFinite(point.y)).map((point) => [+point.x, point.y])),
      // Single-series charts retain the inherited paint bridge (e.g. KpiCard).
      paint: multiple ? `var(--reddb-color-series-${role})` : "var(--color-primary)",
      data: dataset.data.filter((point) => Number.isFinite(+point.x) && Number.isFinite(point.y)).sort((a, b) => +a.x - +b.x)
    };
  });
}
function timeSeriesSamples(datasets) {
  return [...new Map(datasets.flatMap((dataset) => dataset.data.map((point) => [+point.x, point.x]))).values()].sort((a, b) => +a - +b);
}
function nearestTimeIndex(samples, value) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = low + high >>> 1;
    if (+samples[middle] < value) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low === samples.length) return Math.max(0, low - 1);
  return value - +samples[low - 1] <= +samples[low] - value ? low - 1 : low;
}
function timeSeriesDomain(samples) {
  const first = +(samples[0] ?? 0);
  const last = +(samples.at(-1) ?? 1);
  return first === last ? [first - 1, last + 1] : [first, last];
}
function formatTimeSample(value) {
  return value instanceof Date ? `${value.toISOString().slice(0, 19).replace("T", " ")} UTC` : String(value);
}
function timeSeriesDateTicks(samples, capacity) {
  if (!samples.some((sample) => sample instanceof Date)) return void 0;
  const count = Math.min(samples.length, Math.max(2, Math.min(12, Math.floor(capacity))));
  return Array.from({ length: count }, (_, index) => +samples[Math.round(index * (samples.length - 1) / Math.max(1, count - 1))]);
}
function formatTimeTick(value, samples) {
  const stamp = (/* @__PURE__ */ new Date(+value)).toISOString();
  const span = +(samples.at(-1) ?? value) - +(samples[0] ?? value);
  const step = samples.slice(1).reduce((smallest, sample, index) => Math.min(smallest, +sample - +samples[index]), Infinity);
  return span < 1e3 ? stamp.slice(11, 23) : span < 6e4 ? stamp.slice(11, 19) : span < 864e5 ? stamp.slice(11, 16) : step < 864e5 ? stamp.slice(5, 16).replace("T", " ") : span < 366 * 864e5 ? stamp.slice(5, 10) : stamp.slice(0, 10);
}
function timeSeriesValueDomain(domain, area) {
  if (domain === void 0) return void 0;
  const [low, high] = domain;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
    throw new Error("TimeSeries: valueDomain must have two finite, increasing bounds");
  }
  if (area && (low > 0 || high < 0)) throw new Error("TimeSeries: an area valueDomain must include zero");
  return [low, high];
}
function timeSeriesBars(datasets, timestamps = timeSeriesSamples(datasets)) {
  const samples = timestamps.map(Number);
  const positive = /* @__PURE__ */ new Map();
  const negative = /* @__PURE__ */ new Map();
  return datasets.map((dataset) => ({
    id: dataset.id,
    paint: dataset.paint,
    data: samples.flatMap((x, index) => {
      const value = dataset.samples.get(x);
      if (value === void 0) return [];
      const sums = value < 0 ? negative : positive;
      const y = sums.get(x) ?? 0;
      sums.set(x, y + value);
      const previous = samples[index - 1];
      const next = samples[index + 1];
      const step = Math.min(previous === void 0 ? Infinity : x - previous, next === void 0 ? Infinity : next - x);
      const half = (Number.isFinite(step) ? step : 1) * 0.36;
      return [{ x: x - half, x1: x + half, y, y1: y + value }];
    })
  }));
}
function timeSeriesAreas(datasets, timestamps) {
  const positive = /* @__PURE__ */ new Map();
  const negative = /* @__PURE__ */ new Map();
  const complete = new Set(timestamps.map(Number).filter((x) => datasets.every((dataset) => dataset.samples.has(x))));
  return datasets.map((dataset) => ({
    id: dataset.id,
    data: timestamps.map((stamp) => {
      const x = +stamp;
      const value = dataset.samples.get(x);
      if (value === void 0 || !complete.has(x)) return { x, y: 0, y1: 0, defined: false };
      const sums = value < 0 ? negative : positive;
      const y = sums.get(x) ?? 0;
      sums.set(x, y + value);
      return { x, y, y1: y + value, defined: true };
    })
  }));
}
function timeSeriesPadding(samples, domain, valueLabels, formatX, inset, minimal) {
  if (minimal) return { top: inset, right: inset, bottom: 0, left: 0 };
  const dateAxis = samples.some((sample) => sample instanceof Date);
  const boundary = (value) => dateAxis ? new Date(value) : value;
  const candidates = formatX ? [boundary(domain[0]), ...samples, boundary(domain[1])] : [boundary(domain[0]), boundary(domain[1])];
  const labels = candidates.map((value) => formatX ? formatX(value) : dateAxis ? formatTimeTick(value, samples) : String(Number((+value).toPrecision(6))));
  const edge = Math.ceil(axisLabelWidth(labels) / 2) + 6;
  return { top: Math.max(inset, CATEGORY_AXIS_GUTTER_PX / 2), right: Math.max(inset, edge), bottom: CATEGORY_AXIS_GUTTER_PX, left: Math.max(valueAxisGutter(valueLabels) + 6, edge) };
}
export {
  formatTimeSample,
  formatTimeTick,
  nearestTimeIndex,
  timeSeriesAreas,
  timeSeriesBars,
  timeSeriesDatasets,
  timeSeriesDateTicks,
  timeSeriesDomain,
  timeSeriesPadding,
  timeSeriesSamples,
  timeSeriesValueDomain
};
