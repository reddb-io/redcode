function breakdownItems(items) {
  const ids = /* @__PURE__ */ new Set();
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item, index) => {
    if (ids.has(item.id))
      throw new Error(`BreakdownBar: duplicate group id "${item.id}"`);
    if (!Number.isFinite(item.value) || item.value < 0)
      throw new Error("BreakdownBar: contributions must be finite and non-negative");
    ids.add(item.id);
    const series = item.series ?? index % 6 + 1;
    return { ...item, fraction: total > 0 ? item.value / total : 0, paint: `var(--reddb-color-series-${series})` };
  });
}
export {
  breakdownItems
};
