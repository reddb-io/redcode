import { automaticChartPalette, chartColor } from "./chart-color.js";
function breakdownItems(items) {
  const ids = /* @__PURE__ */ new Set();
  const automatic = automaticChartPalette(items);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item, index) => {
    if (ids.has(item.id))
      throw new Error(`BreakdownBar: duplicate group id "${item.id}"`);
    if (!Number.isFinite(item.value) || item.value < 0)
      throw new Error("BreakdownBar: contributions must be finite and non-negative");
    ids.add(item.id);
    return { ...item, fraction: total > 0 ? item.value / total : 0, paint: chartColor(item, void 0, automatic) };
  });
}
export {
  breakdownItems
};
