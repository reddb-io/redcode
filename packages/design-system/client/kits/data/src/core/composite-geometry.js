import { chartWindowPoints } from "./chart-time.js";
import { area, line } from "d3-shape";
import { compositeProject } from "./composite-chart.js";
function compositeGeometry(model, layout, hiddenSeries) {
  const { plotWidth: w, plotHeight: h, horizontal } = layout;
  const sampleLength = horizontal ? h : w;
  const sample = (value) => compositeProject(value, model.sampleDomain, sampleLength);
  const values = (axis) => (value) => {
    const position = compositeProject(value, axis === "primary" ? model.primaryDomain : model.secondaryDomain, horizontal ? w : h);
    return horizontal ? position : h - position;
  };
  const visible = model.series.filter((item) => !hiddenSeries.includes(item.id));
  const slot = model.interval / (model.sampleDomain[1] - model.sampleDomain[0]) * sampleLength * (1 - (model.options?.barPadding ?? 0.28));
  const accumulators = /* @__PURE__ */ new Map();
  const stackTotals = /* @__PURE__ */ new Map();
  const layers = visible.map((series) => {
    const points = chartWindowPoints(series.points, model.sampleDomain, (point) => point.x);
    const value = values(series.axis);
    const columns = visible.filter((item) => item.kind === "column" && item.axis === series.axis);
    const stacked = model.options?.columnMode === "stacked";
    const columnWidth = stacked ? slot : slot / Math.max(1, columns.length);
    const columnOffset = (stacked ? 0 : columns.findIndex((item) => item.id === series.id) * columnWidth) - slot / 2;
    const rects = series.kind === "column" ? points.flatMap((point) => {
      if (point.value === null) return [];
      const key = `${series.axis}:${point.x}:${point.value >= 0 ? "positive" : "negative"}`;
      const start = stacked ? accumulators.get(key) ?? 0 : 0;
      const finish = start + point.value;
      if (stacked) {
        accumulators.set(key, finish);
        stackTotals.set(key, { key: point.x, axis: series.axis, value: finish });
      }
      const base = value(start), end = value(finish), a = sample(point.x) + columnOffset;
      return [horizontal ? { x: Math.min(base, end), y: a, width: Math.abs(base - end), height: columnWidth, paint: point.paint, value: point.value } : { x: a, y: Math.min(base, end), width: columnWidth, height: Math.abs(base - end), paint: point.paint, value: point.value }];
    }) : [];
    const candles = series.kind === "candlestick" ? points.flatMap((point) => {
      const candle = point.candle;
      if (!candle) return [];
      const open = value(candle.open), close = value(candle.close), center = sample(point.x);
      return [{
        key: point.x,
        center,
        x: center - slot / 2,
        y: Math.min(open, close),
        width: slot,
        height: Math.max(1, Math.abs(open - close)),
        high: value(candle.high),
        low: value(candle.low),
        direction: candle.close > candle.open ? "up" : candle.close < candle.open ? "down" : "flat"
      }];
    }) : [];
    const path = series.kind === "line" || series.kind === "area" ? line().defined((point) => point.value !== null).x((point) => horizontal ? value(point.value) : sample(point.x)).y((point) => horizontal ? sample(point.x) : value(point.value))(points) ?? "" : "";
    const fill = series.kind === "area" ? horizontal ? area().defined((point) => point.value !== null).y((point) => sample(point.x)).x0(value(0)).x1((point) => value(point.value))(points) ?? "" : area().defined((point) => point.value !== null).x((point) => sample(point.x)).y0(value(0)).y1((point) => value(point.value))(points) ?? "" : "";
    return { ...series, path, fill, rects, candles };
  });
  const references = model.references.map((reference) => {
    const isSample = reference.kind === "sample", position = isSample ? sample(reference.value) : values(reference.axis)(reference.value);
    const vertical = isSample !== horizontal;
    return { ...reference, x1: vertical ? position : 0, x2: vertical ? position : w, y1: vertical ? 0 : position, y2: vertical ? h : position };
  });
  const totals = [...stackTotals.values()].map((total) => {
    const a = sample(total.key), b = values(total.axis)(total.value);
    return { ...total, format: model.series.find((series) => series.axis === total.axis)?.format, x: horizontal ? b : a, y: horizontal ? a : b };
  });
  return { layers, totals, references, cursor: (key) => sample(key) };
}
function compositeColumnLabel(rect, layout, stacked, format) {
  const text = rect.value === void 0 ? "" : format(rect.value), extent = text.length * 6.5 + 4;
  const visible = layout.horizontal ? rect.height >= 14 && (!stacked || rect.width >= extent) : rect.width >= extent && (!stacked || rect.height >= 14);
  const x = layout.horizontal && !stacked ? Math.max(extent / 2, Math.min(layout.plotWidth - extent / 2, (rect.value ?? 0) >= 0 ? rect.x + rect.width + extent / 2 : rect.x - extent / 2)) : rect.x + rect.width / 2;
  const y = layout.horizontal || stacked ? rect.y + rect.height / 2 : Math.min(layout.plotHeight - 7, Math.max(-12, (rect.value ?? 0) >= 0 ? rect.y - 7 : rect.y + rect.height + 12));
  return { text, visible, x, y };
}
export {
  compositeColumnLabel,
  compositeGeometry
};
