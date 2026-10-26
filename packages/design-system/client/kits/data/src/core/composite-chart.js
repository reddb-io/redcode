import { chartTimeRange } from "./chart-time.js";
import { axisLabelWidth, formatChartNumber } from "../chart.js";
const compositePaint = (series = 1) => `var(--reddb-color-series-${series})`;
const compositeDash = (dash) => dash === "dashed" ? "6 3" : dash === "dotted" ? "2 3" : void 0;
function valueDomain(series, axis, declared) {
  let low = Infinity, high = -Infinity;
  const baseline = series.some((item) => item.axis === axis && (item.kind === "column" || item.kind === "area"));
  if (declared) {
    if (!declared.every(Number.isFinite) || declared[1] <= declared[0] || !Number.isFinite(declared[1] - declared[0])) throw new Error("CompositeChart: value domains must be finite and increasing.");
    if (baseline && (declared[0] > 0 || declared[1] < 0)) throw new Error("CompositeChart: column and area domains must include zero.");
    return [...declared];
  }
  if (baseline) low = high = 0;
  for (const item of series.filter((item2) => item2.axis === axis)) for (const point of item.points) {
    if (point.value === null) continue;
    low = Math.min(low, point.candle?.low ?? point.value);
    high = Math.max(high, point.candle?.high ?? point.value);
  }
  if (!Number.isFinite(low)) return [0, 1];
  if (low === high) {
    const delta = Math.max(Math.abs(low) * 0.05, 1);
    return baseline && low === 0 ? [0, delta] : [low - delta, high + delta];
  }
  return [low, high];
}
function resolveCompositeChart(data, orientation = "vertical", primaryAxis, secondaryAxis, references = [], timeRange) {
  const viewport = chartTimeRange(timeRange);
  const identities = /* @__PURE__ */ new Set();
  const coordinates = data.flatMap((item) => item.data.map((point) => point.x));
  const categorical = coordinates.some((value) => typeof value === "string");
  if (categorical && coordinates.some((value) => typeof value !== "string")) throw new Error("CompositeChart: categories cannot be mixed with numeric or Date coordinates.");
  if (categorical && viewport) throw new Error("CompositeChart: timeRange requires numeric or Date coordinates.");
  const categories = /* @__PURE__ */ new Map();
  for (const value of coordinates) if (typeof value === "string" && !categories.has(value)) categories.set(value, categories.size);
  const coordinate = (value) => typeof value === "string" ? categorical ? categories.get(value) ?? NaN : NaN : categorical ? NaN : +value;
  const original = /* @__PURE__ */ new Map();
  const series = data.map((item, index) => {
    if (!item.id.trim() || identities.has(item.id)) throw new Error("CompositeChart: series ids must be nonempty and unique.");
    identities.add(item.id);
    if (item.axis === "secondary" && !secondaryAxis?.label.trim()) throw new Error("CompositeChart: secondary layers require a named secondaryAxis.");
    if (item.kind === "candlestick" && orientation === "horizontal") throw new Error("CompositeChart: candles require vertical orientation.");
    const samples2 = /* @__PURE__ */ new Map();
    for (const point of item.data) {
      const x = coordinate(point.x);
      if (!Number.isFinite(x)) continue;
      original.set(x, point.x);
      if ("open" in point) {
        const valid = [point.open, point.high, point.low, point.close].every(Number.isFinite) && point.low <= Math.min(point.open, point.close) && point.high >= Math.max(point.open, point.close);
        samples2.set(x, { x, value: valid ? point.close : null, ...valid ? { candle: point } : {} });
      } else samples2.set(x, { x, value: typeof point.y === "number" && Number.isFinite(point.y) ? point.y : null });
    }
    return { id: item.id, label: item.label, kind: item.kind, axis: item.axis ?? "primary", paint: compositePaint(item.series ?? index % 6 + 1), dash: compositeDash("dash" in item ? item.dash : void 0), samples: samples2, points: [...samples2.values()].sort((a, b) => a.x - b.x) };
  });
  const ordered = series.map((item, index) => ({ item, order: data[index].order ?? index })).sort((a, b) => a.order - b.order).map((entry) => entry.item);
  const allSamples = [...original].sort((a, b) => a[0] - b[0]).map(([key, value]) => ({ key, value }));
  const samples = viewport ? allSamples.filter((sample) => sample.key >= viewport[0] && sample.key <= viewport[1]) : allSamples;
  let interval = Infinity;
  for (let i = 1; i < samples.length; i++) interval = Math.min(interval, samples[i].key - samples[i - 1].key);
  if (!Number.isFinite(interval)) interval = samples[0]?.value instanceof Date ? 6e4 : 1;
  const half = interval / 2;
  const sampleDomain = viewport ?? (samples.length ? [samples[0].key - half, samples.at(-1).key + half] : [0, 1]);
  const referenceIds = /* @__PURE__ */ new Set();
  const resolvedReferences = references.flatMap((reference) => {
    if (!reference.id.trim() || referenceIds.has(reference.id)) throw new Error("CompositeChart: reference ids must be nonempty and unique.");
    referenceIds.add(reference.id);
    const value = reference.kind === "value" ? reference.value : coordinate(reference.x);
    const axis = reference.kind === "value" ? reference.axis ?? "primary" : "primary";
    if (axis === "secondary" && !secondaryAxis?.label.trim()) throw new Error("CompositeChart: secondary references require a named secondaryAxis.");
    return Number.isFinite(value) ? [{ id: reference.id, label: reference.label, paint: compositePaint(reference.series ?? 6), kind: reference.kind, value, axis }] : [];
  });
  return { series: ordered, samples, interval, categorical, sampleDomain, primaryDomain: valueDomain(series, "primary", primaryAxis?.domain), secondaryDomain: valueDomain(series, "secondary", secondaryAxis?.domain), references: resolvedReferences };
}
function formatCompositeSample(value) {
  return value instanceof Date ? value.toISOString().replace("T", " ").replace(/\.000Z$/, " UTC") : String(value);
}
function formatCompositeTick(value) {
  return value instanceof Date ? value.toISOString().slice(5, 16).replace("T", " ") : String(value);
}
function compositeNearest(samples, value) {
  let left = 0, right = samples.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (samples[middle].key < value) left = middle + 1;
    else right = middle;
  }
  return left > 0 && Math.abs(samples[left - 1].key - value) <= Math.abs(samples[left].key - value) ? left - 1 : left;
}
function compositeKey(key, index, count) {
  if (!count) return void 0;
  const next = key === "Home" ? 0 : key === "End" ? count - 1 : ["ArrowRight", "ArrowUp"].includes(key) ? index + 1 : ["ArrowLeft", "ArrowDown"].includes(key) ? index - 1 : void 0;
  return next === void 0 ? void 0 : Math.max(0, Math.min(count - 1, next));
}
function compositeReading(series, key, format = formatChartNumber) {
  const point = key === void 0 ? void 0 : series.samples.get(key);
  if (point?.value === null || point?.value === void 0) return "No sample";
  if (!point.candle) return format(point.value);
  const p = point.candle;
  return `Open ${format(p.open)}, High ${format(p.high)}, Low ${format(p.low)}, Close ${format(p.close)}`;
}
function compositeInspection(model, hiddenSeries, active, primaryAxis, secondaryAxis, formatX = formatCompositeSample, hasLegend = true) {
  const visible = model.series.filter((series) => !hiddenSeries.includes(series.id));
  const index = Math.max(0, Math.min(active ?? model.samples.length - 1, model.samples.length - 1));
  const sample = model.samples[index];
  const sampleLabel = sample ? formatX(sample.value) : "No samples";
  const readings = visible.map((series) => ({ id: series.id, label: series.label, value: compositeReading(series, sample?.key, (series.axis === "primary" ? primaryAxis : secondaryAxis)?.format ?? formatChartNumber) }));
  const announcement = `${sampleLabel}. ${readings.map((reading) => `${reading.label}: ${reading.value}`).join(". ")}`;
  const empty = model.series.length > 0 && visible.length === 0 ? hasLegend ? "All series hidden. Use the legend to restore them." : "All series hidden." : visible.every((series) => series.points.every((point) => point.value === null)) ? "No valid samples in this period." : void 0;
  return { index, sample, sampleLabel, readings, announcement, empty };
}
function valueTicks(domain, count) {
  const n = Math.max(1, Math.min(8, Math.floor(count)));
  return Array.from({ length: n + 1 }, (_, index) => domain[0] + index / n * (domain[1] - domain[0]));
}
const compositeProject = (value, domain, length) => (value - domain[0]) / (domain[1] - domain[0]) * length;
function compositeLayout(model, width, height, horizontal = false, presentation = "full", primaryAxis, secondaryAxis, formatX = formatCompositeTick) {
  const primaryFormat = primaryAxis?.format ?? formatChartNumber, secondaryFormat = secondaryAxis?.format ?? formatChartNumber;
  const secondary = model.series.some((item) => item.axis === "secondary") || model.references.some((item) => item.axis === "secondary");
  const primaryValues = valueTicks(model.primaryDomain, horizontal ? width / 100 : height / 48);
  const secondaryValues = secondary ? valueTicks(model.secondaryDomain, horizontal ? width / 100 : height / 48) : [];
  const sampleLabels = model.samples.map((sample) => formatX(sample.value));
  const textRoom = (values) => axisLabelWidth(values) + 10;
  const padding = presentation === "minimal" ? { top: 2, right: 2, bottom: 2, left: 2 } : horizontal ? { top: secondary ? 24 : 10, right: Math.max(textRoom([...primaryValues.map(primaryFormat), ...secondaryValues.map(secondaryFormat)]) / 2, 10), bottom: 24, left: textRoom(sampleLabels) } : { top: 10, right: Math.max(secondary ? textRoom(secondaryValues.map(secondaryFormat)) : 0, textRoom(sampleLabels) / 2), bottom: 24, left: Math.max(textRoom(primaryValues.map(primaryFormat)), textRoom(sampleLabels) / 2) };
  if (padding.left + padding.right > width * 0.7) {
    const ratio = width * 0.7 / (padding.left + padding.right);
    padding.left *= ratio;
    padding.right *= ratio;
  }
  const plotWidth = Math.max(1, width - padding.left - padding.right), plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const sampleLength = horizontal ? plotHeight : plotWidth;
  const sampleTicks = [];
  let lastEnd = -Infinity;
  for (const sample of model.samples) {
    const label = formatX(sample.value), position = compositeProject(sample.key, model.sampleDomain, sampleLength);
    const extent = horizontal ? 16 : axisLabelWidth([label]) + 8;
    const start = position - extent / 2, end = position + extent / 2;
    if (start < lastEnd || start < -0.5 || end > sampleLength + 0.5 || horizontal && axisLabelWidth([label]) > padding.left - 6) continue;
    sampleTicks.push({ value: sample.key, label, position });
    lastEnd = end;
  }
  function ticks(values, domain, format, room) {
    let end = -Infinity;
    return values.flatMap((value) => {
      const label = format(value), position = compositeProject(value, domain, horizontal ? plotWidth : plotHeight), extent = horizontal ? axisLabelWidth([label]) + 8 : 16;
      if (!horizontal && axisLabelWidth([label]) > room - 5 || position - extent / 2 < end) return [];
      end = position + extent / 2;
      return [{ value, label, position: horizontal ? position : plotHeight - position }];
    });
  }
  return { width, height, padding, plotWidth, plotHeight, horizontal, sampleTicks, primaryTicks: ticks(primaryValues, model.primaryDomain, primaryFormat, padding.left), secondaryTicks: ticks(secondaryValues, model.secondaryDomain, secondaryFormat, padding.right) };
}
export {
  compositeDash,
  compositeInspection,
  compositeKey,
  compositeLayout,
  compositeNearest,
  compositePaint,
  compositeProject,
  compositeReading,
  formatCompositeSample,
  formatCompositeTick,
  resolveCompositeChart
};
