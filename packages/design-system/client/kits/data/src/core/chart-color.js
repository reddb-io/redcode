import { tokenColor } from "@reddb-io/design-system/base/recipes";
const CHART_PALETTE_10 = Object.freeze(Array.from({ length: 10 }, (_, i) => `--reddb-color-chart-${i + 1}`));
const CHART_PALETTE_40 = Object.freeze(Array.from({ length: 40 }, (_, i) => `--reddb-color-chart-${i + 1}`));
function chartPaletteFor(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error("Chart palette count must be a nonnegative integer");
  return count <= 10 ? CHART_PALETTE_10 : CHART_PALETTE_40;
}
function automaticChartPalette(items) {
  const compare = new Intl.Collator("en", { numeric: true }).compare;
  const ids = [...new Set(items.map((item) => item.id))].sort((a, b) => compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  const colors = chartPaletteFor(ids.length);
  return Object.fromEntries(ids.map((id, index) => [id, colors[index % colors.length]]));
}
function chartColorToken(item, palette, automatic) {
  return item.color ?? (item.id ? palette?.[item.id] : void 0) ?? (item.series !== void 0 ? void 0 : item.id ? automatic?.[item.id] : void 0);
}
function chartColor(item, palette, automatic) {
  return tokenColor(chartColorToken(item, palette, automatic), `var(--reddb-color-series-${item.series ?? 1})`);
}
function automaticChartColors(items) {
  const automatic = automaticChartPalette(items);
  return items.map((item) => ({ ...item, color: chartColorToken(item, void 0, automatic) }));
}
export {
  CHART_PALETTE_10,
  CHART_PALETTE_40,
  automaticChartColors,
  automaticChartPalette,
  chartColor,
  chartColorToken,
  chartPaletteFor
};
