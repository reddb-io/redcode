import { formatChartNumber, fractionDigitsFor } from "../chart.js";
function histogramBins(values, requestedBins = 10, format) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0)
    return [];
  let minimum = finite[0];
  let maximum = finite[0];
  for (const value of finite.slice(1)) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum === maximum) {
    const edge2 = format ?? ((value) => formatChartNumber(value));
    return [{ x0: minimum, x1: maximum, label: edge2(minimum), count: finite.length }];
  }
  const count = Math.max(1, Math.floor(requestedBins));
  const step = (maximum - minimum) / count;
  const digits = fractionDigitsFor(step);
  const edge = format ?? ((value) => formatChartNumber(value, digits));
  const bins = Array.from({ length: count }, (_, index) => {
    const x0 = minimum + step * index;
    const x1 = index === count - 1 ? maximum : minimum + step * (index + 1);
    return { x0, x1, label: `${edge(x0)}\u2013${edge(x1)}`, count: 0 };
  });
  for (const value of finite) {
    const index = Math.min(count - 1, Math.floor((value - minimum) / step));
    bins[index].count += 1;
  }
  return bins;
}
export {
  histogramBins
};
