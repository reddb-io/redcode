function chartTimeRange(range) {
  if (range === void 0) return void 0;
  const low = +range[0], high = +range[1];
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || !Number.isFinite(high - low)) {
    throw new Error("Chart: timeRange must contain finite, increasing timestamps.");
  }
  return [low, high];
}
function chartTimeIndex(samples, active, timestamp) {
  if (active == null || !Number.isFinite(+active)) return Math.max(0, samples.length - 1);
  let low = 0, high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamp(samples[middle]) < +active) low = middle + 1;
    else high = middle;
  }
  return low > 0 && Math.abs(timestamp(samples[low - 1]) - +active) <= Math.abs(timestamp(samples[low]) - +active) ? low - 1 : low;
}
function chartCursor(active, domain) {
  const value = active == null ? NaN : +active;
  return Number.isFinite(value) && value >= domain[0] && value <= domain[1] ? value : void 0;
}
function chartWindowPoints(points, domain, timestamp) {
  function bound(value, upper) {
    let low = 0, high = points.length;
    while (low < high) {
      const middle = low + high >>> 1, time = timestamp(points[middle]);
      if (time < value || upper && time === value) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  const first = Math.max(0, bound(domain[0], false) - 2), last = Math.min(points.length, bound(domain[1], true) + 2);
  return first === 0 && last === points.length ? points : points.slice(first, last);
}
export {
  chartCursor,
  chartTimeIndex,
  chartTimeRange,
  chartWindowPoints
};
