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
  const slot = model.interval / (model.sampleDomain[1] - model.sampleDomain[0]) * sampleLength * 0.72;
  const layers = visible.map((series) => {
    const points = chartWindowPoints(series.points, model.sampleDomain, (point) => point.x);
    const value = values(series.axis);
    const columns = visible.filter((item) => item.kind === "column" && item.axis === series.axis);
    const columnWidth = slot / Math.max(1, columns.length);
    const columnOffset = columns.findIndex((item) => item.id === series.id) * columnWidth - slot / 2;
    const rects = series.kind === "column" ? points.flatMap((point) => {
      if (point.value === null) return [];
      const base = value(0), end = value(point.value), a = sample(point.x) + columnOffset;
      return [horizontal ? { x: Math.min(base, end), y: a, width: Math.abs(base - end), height: columnWidth } : { x: a, y: Math.min(base, end), width: columnWidth, height: Math.abs(base - end) }];
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
  return { layers, references, cursor: (key) => sample(key) };
}
export {
  compositeGeometry
};
