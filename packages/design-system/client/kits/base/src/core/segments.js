function segmentGeometry(count, percent, columns) {
  if (!Number.isFinite(count) || count < 1)
    throw new Error("segments must be a positive finite number");
  const total = Math.min(128, Math.max(1, Math.floor(count)));
  const perRow = columns === void 0 ? total : Math.min(
    total,
    Math.max(1, Math.floor(Number.isFinite(columns) ? columns : total))
  );
  const fill = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0)) / 100 * total;
  return {
    columns: perRow,
    aggregated: count > total,
    fills: Array.from(
      { length: total },
      (_, i) => Math.min(1, Math.max(0, fill - i)) * 100
    )
  };
}
export {
  segmentGeometry
};
