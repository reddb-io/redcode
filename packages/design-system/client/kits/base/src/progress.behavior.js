function isDeterminate(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function normalizeRange(value, min = 0, max = 100) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const candidateMax = Number.isFinite(max) ? max : safeMin + 100;
  const safeMax = candidateMax > safeMin ? candidateMax : safeMin + 1;
  const candidateValue = Number.isFinite(value) ? value : safeMin;
  const safeValue = Math.min(safeMax, Math.max(safeMin, candidateValue));
  return {
    min: safeMin,
    max: safeMax,
    value: safeValue,
    percent: (safeValue - safeMin) / (safeMax - safeMin) * 100
  };
}
function formatPercent(range) {
  return `${Math.round(range.percent)}%`;
}
export {
  formatPercent,
  isDeterminate,
  normalizeRange
};
