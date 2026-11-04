function formatStatsMetric(value, unit) {
  if (unit === "bytes") {
    const abs = Math.abs(value);
    if (abs >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
    if (abs >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
    if (abs >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${value} B`;
  }
  if (unit === "%" || unit === "ms" || unit === "/s") return `${value.toLocaleString()}${unit}`;
  return value.toLocaleString();
}
function statsGaugePercent(value, maximum) {
  if (value >= 0 && value <= 100) return value;
  return Math.min(100, Math.abs(value) / Math.max(1, maximum) * 100);
}
export {
  formatStatsMetric,
  statsGaugePercent
};
